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

// Simple LRU-style statement cache to avoid re-parsing identical SQL
class StmtCache {
    private cache = new Map<string, { stmt: any, hits: number }>();
    private maxSize: number;

    constructor(maxSize = 100) {
        this.maxSize = maxSize;
    }

    get(sql: string): any | null {
        const entry = this.cache.get(sql);
        if (entry) {
            entry.hits++;
            return entry.stmt;
        }
        return null;
    }

    set(sql: string, stmt: any): void {
        if (this.cache.size >= this.maxSize) {
            // Evict least-hit entry
            let minKey = '';
            let minHits = Infinity;
            for (const [key, val] of this.cache) {
                if (val.hits < minHits) {
                    minHits = val.hits;
                    minKey = key;
                }
            }
            if (minKey) {
                const evicted = this.cache.get(minKey);
                if (evicted?.stmt?.delete) evicted.stmt.delete();
                this.cache.delete(minKey);
            }
        }
        this.cache.set(sql, { stmt, hits: 1 });
    }

    clear(): void {
        for (const [, entry] of this.cache) {
            if (entry.stmt?.delete) entry.stmt.delete();
        }
        this.cache.clear();
    }
}

export class ToySQLite {
    private db: Database;
    private executor: Executor;
    private wasmModule: any;
    private wasmExecutor: any;
    private _prefetchedData: Record<string, any[]> = {};
    private _prefetchedJson: Record<string, string> = {};
    private config: EngineConfig;
    private stmtCache = new StmtCache(50);

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
                    },
                    getTableDataJson: function(tableName: string) {
                        return self._prefetchedJson[tableName] || '[]';
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
                // Try cache first
                const cached = this.stmtCache.get(sql);
                if (cached) {
                    wasmStatement = cached;
                } else {
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
                }

                if (wasmStatement) {
                    const type = wasmStatement.type();

                    // WASM handles SELECT queries (simple WHERE, LIMIT/OFFSET, COUNT, projection)
                    // Only fall back to TS for JOINs, GROUP BY, UNION, subqueries — features
                    // not yet implemented in the WASM executor
                    if (type === 'SELECT') {
                        const upperSQL = sql.toUpperCase();
                        const needsTsFallback = upperSQL.includes('JOIN') || 
                                                upperSQL.includes('GROUP BY') ||
                                                upperSQL.includes('UNION') ||
                                                upperSQL.includes('HAVING');

                        if (!needsTsFallback) {
                            const tableName = (wasmStatement as any).table;
                            if (tableName && tableName !== '*') {
                                const tableData = await this.executor.getFullTableData(tableName);
                                this._prefetchedData[tableName] = tableData;
                                this._prefetchedJson[tableName] = JSON.stringify(tableData);
                                
                                try {
                                    const res = this.wasmExecutor.execute(wasmStatement);
                                    return res;
                                } finally {
                                    // Don't delete cached statements
                                    if (!cached) {
                                        wasmStatement.delete();
                                    }
                                }
                            }
                        }
                    }

                    // Clean up non-cached statements that we didn't use
                    if (!cached) {
                        wasmStatement.delete();
                    }
                }
            } catch (e) {
                if (wasmStatement && !this.stmtCache.get(sql)) wasmStatement.delete();
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
        this.stmtCache.clear();
        this.db.close();
    }
}
