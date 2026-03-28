import { Database } from "./storage/database";
import { Executor } from "./engine/executor";
import { Lexer } from './parser/lexer';
import { Parser } from './parser/parser';
import initSqlEngine from './wasm/sql_engine.js';

export interface EngineConfig {
    /**
     * Whether to use the WebAssembly engine for core processing.
     * Defaults to true.
     */
    useWasm?: boolean;
}

/**
 * Serialize an array of JS objects into a compact binary format for WASM.
 *
 * Format:
 *   [num_rows: u32_le][num_cols: u32_le]
 *   for each col: [name_len: u16_le][name: UTF-8]
 *   for each row, for each col:
 *     [type: u8] 0=null, 1=f64, 2=string
 *     type 1: [f64_le]
 *     type 2: [str_len: u32_le][str: UTF-8]
 */
function serializeToBinary(rows: any[]): Uint8Array {
    if (rows.length === 0) return new Uint8Array(0);

    const encoder = new TextEncoder();

    // Collect column names from first row (excluding internal _rowid)
    const columns: string[] = [];
    const firstRow = rows[0];
    for (const key in firstRow) {
        if (Object.prototype.hasOwnProperty.call(firstRow, key)) {
            columns.push(key);
        }
    }

    // Pre-encode all column names
    const encodedColNames = columns.map(c => encoder.encode(c));

    // Pre-encode all string values and calculate total buffer size
    // Header: 4 (numRows) + 4 (numCols) + sum(2 + nameLen)
    let totalSize = 8;
    for (const enc of encodedColNames) {
        totalSize += 2 + enc.length;
    }

    // Pre-compute row data to get exact size
    const rowEncodings: Array<Array<{ type: number; numVal?: number; strBytes?: Uint8Array }>> = [];
    for (const row of rows) {
        const rowEnc: Array<{ type: number; numVal?: number; strBytes?: Uint8Array }> = [];
        for (const col of columns) {
            const val = row[col];
            if (val === null || val === undefined) {
                rowEnc.push({ type: 0 });
                totalSize += 1;
            } else if (typeof val === 'number') {
                rowEnc.push({ type: 1, numVal: val });
                totalSize += 1 + 8;
            } else {
                const strBytes = encoder.encode(String(val));
                rowEnc.push({ type: 2, strBytes });
                totalSize += 1 + 4 + strBytes.length;
            }
        }
        rowEncodings.push(rowEnc);
    }

    // Write to buffer
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    const u8 = new Uint8Array(buffer);
    let offset = 0;

    // Header
    view.setUint32(offset, rows.length, true); offset += 4;
    view.setUint32(offset, columns.length, true); offset += 4;

    // Column names
    for (const enc of encodedColNames) {
        view.setUint16(offset, enc.length, true); offset += 2;
        u8.set(enc, offset); offset += enc.length;
    }

    // Rows
    for (const rowEnc of rowEncodings) {
        for (const cell of rowEnc) {
            view.setUint8(offset, cell.type); offset += 1;
            if (cell.type === 1) {
                view.setFloat64(offset, cell.numVal!, true); offset += 8;
            } else if (cell.type === 2) {
                view.setUint32(offset, cell.strBytes!.length, true); offset += 4;
                u8.set(cell.strBytes!, offset); offset += cell.strBytes!.length;
            }
        }
    }

    return u8;
}

export class ToySQLite {
    private db: Database;
    private executor: Executor;
    private wasmModule: any;
    private wasmExecutor: any;
    private config: EngineConfig;

    constructor(dbName: string = 'toy_sqlite', version: number = 1, config: EngineConfig = {}) {
        this.db = new Database(dbName, version);
        this.executor = new Executor(this.db);
        this.config = { useWasm: true, ...config };
    }

    /**
     * Initializes the DB connection and sets up the WAL/Data stores.
     * Also initializes the WebAssembly engine if configured.
     * Must be called before `execute()`.
     */
    public async init(): Promise<void> {
        await this.db.open();
        if (this.config.useWasm && !this.wasmModule) {
            try {
                this.wasmModule = await initSqlEngine();
                // IStorage bridge (fallback only — preloadTable is the fast path)
                const StorageBridge = this.wasmModule.IStorage.extend("IStorage", {
                    getTableData: function(_tableName: string) {
                        return [];
                    }
                });
                this.wasmExecutor = new this.wasmModule.Executor(new StorageBridge());
            } catch (e) {
                console.warn("Failed to initialize Wasm engine, falling back to TS:", e);
                this.config.useWasm = false;
            }
        }
    }

    /**
     * Parses and executes a SQLite statement.
     * @param sql The SQL string to execute.
     */
    public async execute(sql: string): Promise<any> {
        if (this.config.useWasm && this.wasmModule) {
            let wasmStatement: any = null;
            try {
                const lexer = new this.wasmModule.Lexer(sql);
                const parser = new this.wasmModule.Parser(lexer);
                try {
                    wasmStatement = parser.parse();
                } catch (e) {
                    // Fallback to TS parser if Wasm parser fails
                } finally {
                    lexer.delete();
                    parser.delete();
                }

                if (wasmStatement) {
                    const type = wasmStatement.type();

                    if (type === 'SELECT') {
                        const upperSQL = sql.toUpperCase();
                        const needsTsFallback = upperSQL.includes('JOIN') ||
                                                upperSQL.includes('GROUP BY') ||
                                                upperSQL.includes('UNION') ||
                                                upperSQL.includes('HAVING');

                        if (!needsTsFallback) {
                            const tableName = (wasmStatement as any).table;
                            if (tableName && tableName !== '*') {
                                // Fetch data, serialize to binary, and load directly into WASM memory
                                const tableData = await this.executor.getFullTableData(tableName);
                                const binary = serializeToBinary(tableData);
                                let ptr = 0;

                                try {
                                    if (binary.byteLength > 0) {
                                        ptr = this.wasmModule._malloc(binary.byteLength);
                                        this.wasmModule.HEAPU8.set(binary, ptr);
                                        this.wasmExecutor.preloadTable(tableName, ptr, binary.byteLength);
                                    }

                                    const res = this.wasmExecutor.execute(wasmStatement);
                                    return res;
                                } finally {
                                    this.wasmExecutor.clearPreload(tableName);
                                    if (ptr) this.wasmModule._free(ptr);
                                    if (wasmStatement) {
                                        wasmStatement.delete();
                                        wasmStatement = null;
                                    }
                                }
                            }
                        }
                    }

                    if (wasmStatement) {
                        wasmStatement.delete();
                        wasmStatement = null;
                    }
                }
            } catch (e) {
                if (wasmStatement) {
                    wasmStatement.delete();
                    wasmStatement = null;
                }
            }
        }

        // Fallback to TS for everything else or if Wasm is disabled
        const tsLexer = new Lexer(sql);
        const tsParser = new Parser(tsLexer);
        const tsStatement = tsParser.parse();

        const res = await this.executor.execute(tsStatement);
        return res;
    }

    /**
     * Shorthand for COMMIT.
     */
    public async commit(): Promise<any> {
        return this.execute('COMMIT');
    }

    /**
     * Shorthand for ROLLBACK.
     */
    public async rollback(): Promise<any> {
        return this.execute('ROLLBACK');
    }

    /**
     * Closes the database connection.
     */
    public close(): void {
        this.db.close();
    }
}
