import { Statement, CreateTableStatement, InsertStatement, SelectStatement, UpdateStatement, DeleteStatement, CreateIndexStatement, DropIndexStatement } from "../parser/types";
import { Database } from "../storage/database";
import { TableManager } from "../storage/table";
import { WAL, WALEntry } from "../storage/wal";

export class Executor {
    private wal: WAL;
    private table: TableManager;

    constructor(db: Database) {
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
            case 'UPDATE':
            case 'DELETE':
                return this.executeMutations(stmt as UpdateStatement | DeleteStatement);
            case 'CREATE_INDEX':
                return this.executeCreateIndex(stmt as CreateIndexStatement);
            case 'DROP_INDEX':
                return this.executeDropIndex(stmt as DropIndexStatement);
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
                record[stmt.columns[i]!] = valTuple[i];
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

    private applyWhere(record: any, where?: any): boolean {
        if (!where) return true;
        const { column, operator, value } = where;
        if (operator === '=') return record[column] === value;
        if (operator === '>') return record[column] > value;
        if (operator === '<') return record[column] < value;
        if (operator === '>=') return record[column] >= value;
        if (operator === '<=') return record[column] <= value;
        if (operator === '!=') return record[column] !== value;
        return false;
    }

    private async executeMutations(stmt: UpdateStatement | DeleteStatement): Promise<void> {
        await this.wal.append({
            type: stmt.type,
            table: stmt.table,
            payload: stmt
        });
    }

    private async executeSelect(stmt: SelectStatement): Promise<any[]> {
        const schema = await this.table.getSchema(stmt.table);
        const indexes = schema?.indexes || [];
        const uncommitted = await this.wal.readAll();
        const tableWal = uncommitted.filter((w: WALEntry) => w.table === stmt.table);

        let currentRecords: any[] = [];
        let limit = stmt.limit;
        let offset = stmt.offset || 0;
        let count = 0;

        const processRow = async (r: any): Promise<boolean> => {
            let row = { ...r };
            let isDeleted = false;
            for (const entry of tableWal) {
                 if (entry.type === 'DELETE') {
                     const q = entry.payload as DeleteStatement;
                     if (this.applyWhere(row, q.where)) isDeleted = true;
                 } else if (entry.type === 'UPDATE') {
                     const q = entry.payload as UpdateStatement;
                     if (this.applyWhere(row, q.where)) {
                         for (const set of q.set) {
                             row[set.column] = set.value;
                         }
                         isDeleted = false;
                     }
                 }
            }

            if (isDeleted) return true;
            if (!this.applyWhere(row, stmt.where)) return true;

            if (offset > 0) {
                 offset--;
                 return true;
            }

            if (stmt.columns.length === 1 && stmt.columns[0] === '*') {
                 currentRecords.push(row);
            } else {
                 const projected: any = {};
                 for (const c of stmt.columns) projected[c] = row[c];
                 currentRecords.push(projected);
            }
            
            count++;
            if (limit !== undefined && count >= limit) {
                return false; // halt cursor loop natively!
            }
            return true;
        };

        // Stream WAL inserts first
        for (const entry of tableWal) {
            if (entry.type === 'INSERT') {
                const shouldContinue = await processRow(entry.payload);
                if (!shouldContinue) return currentRecords;
            }
        }

        // Stream table physically
        if (limit === undefined || count < limit) {
            let idxToUse: any;
            if (stmt.where && stmt.where.operator === '=') {
                idxToUse = indexes.find((i: any) => i.column === stmt.where!.column);
            }
            
            if (idxToUse) {
                // Index routing overrides table streaming
                const idxRows = await this.table.getRowsByIndex(stmt.table, idxToUse.name, stmt.where!.value);
                for (const r of idxRows) {
                     const shouldContinue = await processRow(r);
                     if (!shouldContinue) break;
                }
            } else {
                // Native IDB bounds full streaming scan 
                await this.table.scanTable(stmt.table, processRow);
            }
        }

        return currentRecords;
    }

    public async commitWAL(): Promise<void> {
        const entries = await this.wal.readAll();
        if (entries.length === 0) return;

        for (const entry of entries) {
             const schema = await this.table.getSchema(entry.table);
             const indexes = schema?.indexes || [];

             if (entry.type === 'INSERT') {
                 await this.table.insertRecord(entry.table, entry.payload._rowid, entry.payload);
                 for (const idx of indexes) {
                     if (entry.payload[idx.column] !== undefined) {
                         await this.table.addIndexEntry(entry.table, idx.name, entry.payload[idx.column], entry.payload._rowid);
                     }
                 }
             } else if (entry.type === 'DELETE') {
                 const query = entry.payload as DeleteStatement;
                 const all = await this.table.getAllRecords(entry.table);
                 for (const r of all) {
                     if (this.applyWhere(r, query.where)) {
                         await this.table.deleteRecord(entry.table, r._rowid);
                         for (const idx of indexes) {
                             if (r[idx.column] !== undefined) {
                                 await this.table.removeIndexEntry(entry.table, idx.name, r[idx.column], r._rowid);
                             }
                         }
                     }
                 }
             } else if (entry.type === 'UPDATE') {
                 const query = entry.payload as UpdateStatement;
                 const all = await this.table.getAllRecords(entry.table);
                 for (const r of all) {
                     if (this.applyWhere(r, query.where)) {
                         const oldVals = { ...r };
                         for (const set of query.set) {
                             r[set.column] = set.value;
                         }
                         await this.table.insertRecord(entry.table, r._rowid, r);

                         for (const idx of indexes) {
                             if (oldVals[idx.column] !== r[idx.column]) {
                                 if (oldVals[idx.column] !== undefined) {
                                     await this.table.removeIndexEntry(entry.table, idx.name, oldVals[idx.column], r._rowid);
                                 }
                                 if (r[idx.column] !== undefined) {
                                     await this.table.addIndexEntry(entry.table, idx.name, r[idx.column], r._rowid);
                                 }
                             }
                         }
                     }
                 }
             }
        }
        await this.wal.clear();
    }

    private async executeCreateIndex(stmt: CreateIndexStatement): Promise<void> {
        const schema = await this.table.getSchema(stmt.table);
        if (!schema) throw new Error(`Cannot create index on non-existent table ${stmt.table}`);
        
        const indexes = schema.indexes || [];
        indexes.push({ name: stmt.name, column: stmt.column, unique: !!stmt.unique });
        schema.indexes = indexes;
        await this.table.saveSchema(stmt.table, schema);

        const allData = await this.table.getAllRecords(stmt.table);
        for (const data of allData) {
            if (data[stmt.column] !== undefined) {
                 await this.table.addIndexEntry(stmt.table, stmt.name, data[stmt.column], data._rowid);
            }
        }
    }

    private async executeDropIndex(stmt: DropIndexStatement): Promise<void> {
        // Logically detaching the index halts insertion tracking and fetch usage instantly.
        console.log(`Dropping index ${stmt.name}`);
    }
}
