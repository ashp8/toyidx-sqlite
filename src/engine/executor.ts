import { Statement, CreateTableStatement, InsertStatement, SelectStatement } from "../parser/types";
import { Database } from "../storage/database";
import { TableManager } from "../storage/table";
import { WAL, WALEntry } from "../storage/wal";

export class Executor {
    private wal: WAL;
    private table: TableManager;

    constructor(private db: Database) {
        this.wal = new WAL(db);
        this.table = new TableManager(db);
    }

    public async execute(stmt: Statement): Promise<any> {
        switch (stmt.type) {
            case 'CREATE_TABLE':
                return this.executeCreateTable(stmt as CreateTableStatement);
            case 'INSERT':
                return this.executeInsert(stmt as InsertStatement);
            case 'SELECT':
                return this.executeSelect(stmt as SelectStatement);
            default:
                throw new Error(`Unsupported statement type: ${(stmt as any).type}`);
        }
    }

    private async executeCreateTable(stmt: CreateTableStatement): Promise<void> {
        await this.table.saveSchema(stmt.name, {
            columns: stmt.columns,
            primaryKey: stmt.primaryKey
        });
        
        await this.wal.append({
            type: 'CREATE_TABLE',
            table: stmt.name,
            payload: stmt
        });
    }

    private async executeInsert(stmt: InsertStatement): Promise<number[]> {
        const ids: number[] = [];
        const schema = await this.table.getSchema(stmt.table);
        if (!schema) {
            throw new Error(`No such table: ${stmt.table}`);
        }

        for (const valTuple of stmt.values) {
            const record: any = {};
            for (let i = 0; i < stmt.columns.length; i++) {
                record[stmt.columns[i]] = valTuple[i];
            }
            
            const rowId = await this.table.getNextRowId(stmt.table);
            record._rowid = rowId;

            // Log into WAL instead of directly inserting
            await this.wal.append({
                type: 'INSERT',
                table: stmt.table,
                payload: record
            });

            ids.push(rowId);
        }

        return ids;
    }

    private async executeSelect(stmt: SelectStatement): Promise<any[]> {
        const records = await this.table.getAllRecords(stmt.table);
        
        const uncommitted = await this.wal.readAll();
        const tableWal = uncommitted.filter((w: WALEntry) => w.table === stmt.table);

        for (const entry of tableWal) {
            if (entry.type === 'INSERT') {
                records.push(entry.payload);
            }
        }

        let filtered = records;
        if (stmt.where) {
             const { column, operator, value } = stmt.where;
             filtered = records.filter((r: any) => {
                 if (operator === '=') return r[column] === value;
                 if (operator === '>') return r[column] > value;
                 if (operator === '<') return r[column] < value;
                 if (operator === '>=') return r[column] >= value;
                 if (operator === '<=') return r[column] <= value;
                 if (operator === '!=') return r[column] !== value;
                 return false;
             });
        }

        if (stmt.columns.length === 1 && stmt.columns[0] === '*') {
             return filtered;
        }

        return filtered.map((r: any) => {
             const projected: any = {};
             for (const col of stmt.columns) {
                 projected[col] = r[col];
             }
             return projected;
        });
    }

    public async commitWAL(): Promise<void> {
        const entries = await this.wal.readAll();
        if (entries.length === 0) return;

        for (const entry of entries) {
             if (entry.type === 'INSERT') {
                 await this.table.insertRecord(entry.table, entry.payload._rowid, entry.payload);
             }
        }
        await this.wal.clear();
    }
}
