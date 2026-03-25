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

export class ToySQLite {
    private db: Database;
    private executor: Executor;
    private wasmModule: any;
    private wasmExecutor: any;
    private _prefetchedData: Record<string, any[]> = {};
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
                // Implement IStorage bridge
                const self = this;
                const StorageBridge = this.wasmModule.IStorage.extend("IStorage", {
                    getTableData: function(tableName: string) {
                        return self._prefetchedData[tableName] || [];
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
                    const upperSQL = sql.toUpperCase();
                    const isComplex = upperSQL.includes('JOIN') || 
                                    upperSQL.includes('GROUP BY') || 
                                    upperSQL.includes('UNION') || 
                                    upperSQL.includes('LIKE') || 
                                    upperSQL.includes('IN (') || 
                                    upperSQL.includes('BETWEEN') ||
                                    upperSQL.includes('SUM(') ||
                                    upperSQL.includes('AVG(');

                    if (type === 'SELECT' && !isComplex) {
                        const tableName = (wasmStatement as any).table;
                        if (tableName && tableName !== '*') {
                            this._prefetchedData[tableName] = await this.executor.getFullTableData(tableName);
                            
                            try {
                                const res = this.wasmExecutor.execute(wasmStatement);
                                return res;
                            } finally {
                                wasmStatement.delete();
                            }
                        }
                    }
                    wasmStatement.delete();
                }
            } catch (e) {
                if (wasmStatement) wasmStatement.delete();
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
