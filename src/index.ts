import { Database } from "./storage/database";
import { Executor } from "./engine/executor";
import { TableManager } from "./storage/table";
import { Lexer } from './parser/lexer';
import { Parser } from './parser/parser';
import { Statement } from './parser/types';
import initSqlEngine from './wasm/sql_engine.js';

export class ToySQLite {
    private db: Database;
    private executor: Executor;
    private wasmModule: any;
    private wasmExecutor: any;
    private _prefetchedData: Record<string, any[]> = {};

    constructor(dbName: string = 'toy_sqlite', version: number = 1) {
        this.db = new Database(dbName, version);
        this.executor = new Executor(this.db);
    }

    /**
     * Initializes the DB connection and sets up the WAL/Data stores.
     * Also initializes the WebAssembly engine.
     * Must be called before `execute()`.
     */
    public async init(): Promise<void> {
        await this.db.open();
        if (!this.wasmModule) {
            this.wasmModule = await initSqlEngine();
            // Implement IStorage bridge
            const self = this;
            const StorageBridge = this.wasmModule.IStorage.extend("IStorage", {
                getTableData: function(tableName: string) {
                    return self._prefetchedData[tableName] || [];
                }
            });
            this.wasmExecutor = new this.wasmModule.Executor(new StorageBridge());
        }
    }

    /**
     * Parses and executes a SQLite statement.
     * @param sql The SQL string to execute.
     */
    public async execute(sql: string): Promise<any> {
        let wasmStatement: any = null;
        
        try {
            const lexer = new this.wasmModule.Lexer(sql);
            const parser = new this.wasmModule.Parser(lexer);
            try {
                wasmStatement = parser.parse();
            } catch (e) {
                // Fallback to TS parser if Wasm parser fails or keyword is unsupported
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
            // Ignore Wasm errors and proceed to fallback
            if (wasmStatement) wasmStatement.delete();
        }

        // Fallback to TS for everything else
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
