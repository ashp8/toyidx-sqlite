import { Database } from './storage/database';
import { Executor } from './engine/executor';
import { Lexer } from './parser/lexer';
import { Parser } from './parser/parser';
import { Statement } from './parser/types';

export class ToySQLite {
    private db: Database;
    private executor: Executor;

    constructor(dbName: string = 'toy_sqlite', version: number = 1) {
        this.db = new Database(dbName, version);
        this.executor = new Executor(this.db);
    }

    /**
     * Initializes the DB connection and sets up the WAL/Data stores.
     * Must be called before `execute()`.
     */
    public async init(): Promise<void> {
        await this.db.open();
    }

    /**
     * Parses and executes a SQLite statement.
     * @param sql The SQL string to execute.
     */
    public async execute(sql: string): Promise<any> {
        const lexer = new Lexer(sql);
        const parser = new Parser(lexer);
        const statement: Statement = parser.parse();
        
        return await this.executor.execute(statement);
    }

    /**
     * Commits all entries from the WAL (uncommitted logs) into the main store.
     */
    public async commit(): Promise<void> {
        await this.executor.commitWAL();
    }

    /**
     * Closes the database connection.
     */
    public close(): void {
        this.db.close();
    }
}

// Export internal primitives in case package consumers want to build independently
export * from './parser/types';
export * from './parser/lexer';
export * from './parser/parser';
export * from './storage/database';
export * from './storage/table';
export * from './storage/wal';
export * from './engine/executor';
