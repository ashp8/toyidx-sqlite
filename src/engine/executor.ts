import { Statement, CreateTableStatement, InsertStatement, SelectStatement, UpdateStatement, DeleteStatement, CreateIndexStatement, DropIndexStatement, TransactionStatement, CreateViewStatement, DropTableStatement, AlterTableStatement, WhereClause } from "../parser/types";
import { Database } from "../storage/database";
import { TableManager } from "../storage/table";
import { WAL, WALEntry } from "../storage/wal";

export class Executor {
    private wal: WAL;
    private table: TableManager;
    private inTransaction: boolean = false;

    constructor(db: Database) {
        this.wal = new WAL(db);
        this.table = new TableManager(db);
    }

    public isInTransaction(): boolean {
        return this.inTransaction;
    }

    public async execute(stmt: Statement): Promise<any> {
        let result;
        switch (stmt.type) {
            case 'CREATE_TABLE':
                result = await this.executeCreateTable(stmt as CreateTableStatement);
                break;
            case 'INSERT':
                result = await this.executeInsert(stmt as InsertStatement);
                break;
            case 'SELECT':
                result = await this.executeSelect(stmt as SelectStatement);
                break;
            case 'UPDATE':
            case 'DELETE':
                result = await this.executeMutations(stmt as UpdateStatement | DeleteStatement);
                break;
            case 'CREATE_INDEX':
                result = await this.executeCreateIndex(stmt as CreateIndexStatement);
                break;
            case 'DROP_INDEX':
                result = await this.executeDropIndex(stmt as DropIndexStatement);
                break;
            case 'TRANSACTION':
                result = await this.executeTransaction(stmt as TransactionStatement);
                break;
            case 'CREATE_VIEW':
                result = await this.executeCreateView(stmt as CreateViewStatement);
                break;
            case 'DROP_TABLE':
                result = await this.executeDropTable(stmt as DropTableStatement);
                break;
            case 'ALTER_TABLE':
                result = await this.executeAlterTable(stmt as AlterTableStatement);
                break;
            default:
                throw new Error(`Unsupported statement type: ${(stmt as any).type}`);
        }

        if (!this.inTransaction && stmt.type !== 'SELECT' && stmt.type !== 'TRANSACTION') {
            await this.commitWAL();
        }

        return result;
    }

    private async executeCreateTable(stmt: CreateTableStatement): Promise<void> {
        if (stmt.ifNotExists) {
            const existing = await this.table.getSchema(stmt.name);
            if (existing) {
                return; // Schema already exists, do nothing
            }
        }

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

    private async executeInsert(stmt: InsertStatement): Promise<any[]> {
        const ids: number[] = [];
        const returningRows: any[] = [];
        const schema = await this.table.getSchema(stmt.table);
        if (!schema) {
            throw new Error(`No such table: ${stmt.table}`);
        }
        
        const uniqueColumns: string[] = [...(schema.primaryKey || [])];
        if (schema.columns) {
             schema.columns.forEach((c: any) => {
                  if (c.isUnique && !uniqueColumns.includes(c.name)) uniqueColumns.push(c.name);
             });
        }
        
        const pkColumn = schema.primaryKey && schema.primaryKey.length === 1 ? schema.primaryKey[0] : null;

        let insertValues = stmt.values || [];
        if (stmt.select) {
            const selectResults = await this.executeSelect(stmt.select);
            insertValues = selectResults.map(r => {
                const tuple: any[] = [];
                if (stmt.select!.columns.length === 1 && stmt.select!.columns[0] === '*') {
                    return Object.values(r);
                } else {
                    for (const c of stmt.select!.columns) {
                        let key = c;
                        tuple.push(r[key]);
                    }
                    return tuple;
                }
            });
        }

        const targetCols = stmt.columns.length > 0 ? stmt.columns : (schema.columns?.map((c: any) => c.name) || []);

        const uniqueValues: Record<string, Set<any>> = {};
        if (uniqueColumns.length > 0) {
            for (const col of uniqueColumns) {
                uniqueValues[col] = new Set();
            }
            const currentData = await this.getFullTableData(stmt.table);
            for (const row of currentData) {
                for (const col of uniqueColumns) {
                    if (row[col] !== undefined && row[col] !== null) {
                        uniqueValues[col]?.add(row[col]);
                    }
                }
            }
        }

        for (const valTuple of insertValues) {
            const record: any = {};
            for (let i = 0; i < targetCols.length; i++) {
                record[targetCols[i]!] = valTuple[i];
            }
            
            let skipRow = false;
            for (const col of uniqueColumns) {
                const val = record[col];
                if (val !== undefined && val !== null) {
                    if (uniqueValues[col]?.has(val)) {
                        if (stmt.orIgnore) {
                            skipRow = true;
                            break;
                        } else if (stmt.orReplace) {
                            const oldRows = await this.executeSelect({
                                type: 'SELECT',
                                table: stmt.table,
                                columns: ['*'],
                                where: { column: col, operator: '=', value: val },
                                limit: 1
                            });
                            if (oldRows.length > 0) {
                                const oldRow = oldRows[0];
                                for (const uc of uniqueColumns) {
                                    if (oldRow[uc] !== undefined && oldRow[uc] !== null) {
                                        uniqueValues[uc]?.delete(oldRow[uc]);
                                    }
                                }
                            }
                            await this.wal.append({
                                type: 'DELETE',
                                table: stmt.table,
                                payload: { type: 'DELETE', table: stmt.table, where: { column: col, operator: '=', value: val } }
                            });
                        } else {
                            throw new Error(`UNIQUE constraint failed: ${stmt.table}.${col}`);
                        }
                    }
                }
            }
            if (skipRow) continue;
            
            let rowId: number;
            if (pkColumn && record[pkColumn] !== undefined) {
                rowId = record[pkColumn];
                await this.table.updateSeqIfHigher(stmt.table, rowId);
            } else {
                rowId = await this.table.getNextRowId(stmt.table);
                if (pkColumn) {
                    record[pkColumn] = rowId;
                }
            }
            
            record._rowid = rowId;

            // Cache new unique values immediately to evaluate next iteration rows accurately
            for (const col of uniqueColumns) {
                const val = record[col];
                if (val !== undefined && val !== null) {
                    uniqueValues[col]?.add(val);
                }
            }

            await this.wal.append({
                type: 'INSERT',
                table: stmt.table,
                payload: record
            });

            ids.push(rowId);

            if (stmt.returning) {
                if (stmt.returning.includes('*')) {
                    returningRows.push(record);
                } else {
                    const ret: any = {};
                    for (const col of stmt.returning) {
                        ret[col] = record[col];
                    }
                    returningRows.push(ret);
                }
            }
        }

        if (stmt.returning) return returningRows;
        return ids;
    }

    private async applyWhere(record: any, where?: WhereClause, treatRhsAsColumn: boolean = false): Promise<boolean> {
        if (!where) return true;

        if (where.operator === 'AND' && where.and && where.or) {
            return (await this.applyWhere(record, where.and, treatRhsAsColumn)) && (await this.applyWhere(record, where.or, treatRhsAsColumn));
        }
        if (where.operator === 'OR' && where.and && where.or) {
            return (await this.applyWhere(record, where.and, treatRhsAsColumn)) || (await this.applyWhere(record, where.or, treatRhsAsColumn));
        }

        let val = record[where.column];
        if (val === undefined && where.column.includes('.')) {
            val = record[where.column.split('.')[1] as string];
        }

        let rhs = where.value;
        if (typeof rhs === 'object' && rhs !== null && rhs.type === 'SELECT') {
            const subRes = await this.executeSelect(rhs as SelectStatement);
            if (subRes.length > 0) {
                rhs = Object.values(subRes[0])[0];
            } else {
                rhs = null;
            }
        } else if (treatRhsAsColumn && typeof rhs === 'string') {
            if (record[rhs] !== undefined) {
                rhs = record[rhs];
            } else if (rhs.includes('.') && record[rhs.split('.')[1] as string] !== undefined) {
                rhs = record[rhs.split('.')[1] as string];
            }
        }

        const op = where.operator;
        if (op === '=') return val === rhs;
        if (op === '>') return val > rhs;
        if (op === '<') return val < rhs;
        if (op === '>=') return val >= rhs;
        if (op === '<=') return val <= rhs;
        if (op === '!=') return val !== rhs;
        if (op === 'IS NULL') return val === null || val === undefined;
        if (op === 'IS NOT NULL') return val !== null && val !== undefined;
        if (op === 'LIKE') {
            if (!val || typeof val !== 'string') return false;
            const regex = new RegExp('^' + rhs.replace(/%/g, '.*') + '$', 'i');
            return regex.test(val);
        }
        if (op === 'IN') {
            if (!Array.isArray(rhs)) return false;
            return rhs.includes(val);
        }
        if (op === 'BETWEEN') {
            if (!Array.isArray(rhs) || rhs.length !== 2) return false;
            return val >= rhs[0] && val <= rhs[1];
        }
        return false;
    }

    private async executeMutations(stmt: UpdateStatement | DeleteStatement): Promise<void> {
        await this.wal.append({
            type: stmt.type,
            table: stmt.table,
            payload: stmt
        });
    }

    private async getFullTableData(tableName: string, where?: WhereClause): Promise<any[]> {
        const uncommitted = await this.wal.readAll();
        const tableWal = uncommitted.filter((w: WALEntry) => w.table === tableName);
        const hasMutations = tableWal.some(w => w.type === 'UPDATE' || w.type === 'DELETE');

        let useIndex = false;
        let indexName = '';
        let indexValue: any = null;
        let indexColumn = '';

        if (!hasMutations && where && where.operator === '=' && !where.or) {
            const schema = await this.table.getSchema(tableName);
            const indexes = schema?.indexes || [];
            
            let colName = where.column;
            if (colName.includes('.')) {
                const parts = colName.split('.');
                if (parts[0] === tableName) colName = parts[1] as string;
            }

            const idx = indexes.find((i: any) => i.column === colName);
            if (idx) {
                useIndex = true;
                indexName = idx.name;
                indexColumn = colName;
                indexValue = where.value;
            }
        }

        let current: any[];
        if (useIndex) {
            current = await this.table.getRowsByIndex(tableName, indexName, indexValue);
        } else {
            const all = await this.table.getAllRecords(tableName);
            current = [...all];
        }
        
        for (const entry of tableWal) {
            if (entry.type === 'INSERT') {
                if (!useIndex || entry.payload[indexColumn] === indexValue) {
                    current.push(entry.payload);
                }
            } else if (entry.type === 'UPDATE') {
                const q = entry.payload as UpdateStatement;
                for (let i = 0; i < current.length; i++) {
                    if (await this.applyWhere(current[i], q.where)) {
                        for (const set of q.set) {
                             current[i][set.column] = set.value;
                        }
                    }
                }
            } else if (entry.type === 'DELETE') {
                const q = entry.payload as DeleteStatement;
                const next = [];
                for (const r of current) {
                    if (!(await this.applyWhere(r, q.where))) {
                        next.push(r);
                    }
                }
                current = next;
            }
        }
        return current;
    }

    private evaluateColumn(colExpr: string, group: any[]): { alias: string, value: any } {
        let expr = colExpr;
        let alias = colExpr;
        const asMatch = colExpr.match(/(.*)\s+AS\s+(.*)/i);
        if (asMatch && asMatch[1] && asMatch[2]) {
            expr = asMatch[1].trim();
            alias = asMatch[2].trim();
        }

        const aggMatch = expr.match(/(COUNT|SUM|MAX|MIN|AVG)\s*\(\s*(.*)\s*\)/i);
        if (aggMatch && aggMatch[1] && aggMatch[2]) {
            const func = aggMatch[1].toUpperCase();
            const innerCol = aggMatch[2].trim();
            let value = 0;
            if (func === 'COUNT') value = group.length;
            else if (func === 'SUM') value = group.reduce((sum, r) => sum + (Number(r[innerCol] || r[innerCol.split('.')[1] as string]) || 0), 0);
            else if (func === 'MAX') value = Math.max(...group.map(r => Number(r[innerCol] || r[innerCol.split('.')[1] as string]) || -Infinity));
            else if (func === 'MIN') value = Math.min(...group.map(r => Number(r[innerCol] || r[innerCol.split('.')[1] as string]) || Infinity));
            else if (func === 'AVG') value = group.reduce((sum, r) => sum + (Number(r[innerCol] || r[innerCol.split('.')[1] as string]) || 0), 0) / (group.length || 1);
            return { alias, value };
        }

        let value = group[0] ? (group[0][expr] !== undefined ? group[0][expr] : group[0][expr.split('.')[1] as string]) : null;
        return { alias, value };
    }

    private async executeSelect(stmt: SelectStatement): Promise<any[]> {
        let records = await this.getFullTableData(stmt.table, stmt.where);

        if (stmt.joins) {
            for (const join of stmt.joins) {
                const joinData = await this.getFullTableData(join.table);
                
                let useHashJoin = false;
                let hashJoinColLeft = '';
                let hashJoinColRight = '';
                
                if (join.on && join.on.operator === '=' && typeof join.on.value === 'string' && join.on.value.includes('.')) {
                     const leftParts = join.on.column.split('.');
                     const rightParts = join.on.value.split('.');
                     if (leftParts.length === 2 && rightParts.length === 2) {
                          if (Object.keys(records[0] || {}).some(k => k.startsWith(leftParts[0] + '.')) || leftParts[0] === stmt.table) {
                              hashJoinColLeft = join.on.column;
                              hashJoinColRight = join.on.value;
                              useHashJoin = true;
                          } else {
                              hashJoinColLeft = join.on.value;
                              hashJoinColRight = join.on.column;
                              useHashJoin = true;
                          }
                     }
                }

                let joinDataMap: Map<any, any[]> | null = null;
                if (useHashJoin) {
                    joinDataMap = new Map();
                    const rawRightCol = hashJoinColRight.split('.')[1] as string;
                    for (const r2 of joinData) {
                        const val = r2[rawRightCol] !== undefined ? r2[rawRightCol] : r2[hashJoinColRight];
                        if (val !== undefined && val !== null) {
                            if (!joinDataMap.has(val)) joinDataMap.set(val, []);
                            joinDataMap.get(val)!.push(r2);
                        }
                    }
                }

                const newRecords: any[] = [];
                for (const r1 of records) {
                    let matched = false;
                    
                    if (useHashJoin && joinDataMap) {
                        const r1RawLeftCol = hashJoinColLeft.split('.')[1] as string;
                        const leftVal = r1[hashJoinColLeft] !== undefined ? r1[hashJoinColLeft] : r1[r1RawLeftCol];
                        const matchingR2s = joinDataMap.get(leftVal) || [];
                        
                        for (const r2 of matchingR2s) {
                            const merged = { ...r1 };
                            Object.keys(r1).forEach(k => merged[`${stmt.table}.${k}`] = r1[k]);
                            Object.keys(r2).forEach(k => merged[`${join.table}.${k}`] = r2[k]);
                            Object.keys(r2).forEach(k => merged[k] = r2[k]);
                            
                            if (await this.applyWhere(merged, join.on, true)) {
                                newRecords.push(merged);
                                matched = true;
                            }
                        }
                    } else {
                        for (const r2 of joinData) {
                            const merged = { ...r1 };
                            Object.keys(r1).forEach(k => merged[`${stmt.table}.${k}`] = r1[k]);
                            Object.keys(r2).forEach(k => merged[`${join.table}.${k}`] = r2[k]);
                            Object.keys(r2).forEach(k => merged[k] = r2[k]);
                            
                            if (!join.on || await this.applyWhere(merged, join.on, true)) {
                                newRecords.push(merged);
                                matched = true;
                            }
                        }
                    }
                    
                    if (!matched && join.type === 'LEFT') {
                        const merged = { ...r1 };
                        Object.keys(r1).forEach(k => merged[`${stmt.table}.${k}`] = r1[k]);
                        newRecords.push(merged);
                    }
                }
                records = newRecords;
            }
        }

        const filtered = [];
        for (const r of records) {
             if (await this.applyWhere(r, stmt.where)) {
                  filtered.push(r);
             }
        }
        records = filtered;

        let grouped: { keys: any[], records: any[] }[] = [];
        if (stmt.groupBy) {
            for (const r of records) {
                const keys = stmt.groupBy.map(g => r[g] || r[g.split('.')[1] as string]);
                let group = grouped.find(g => JSON.stringify(g.keys) === JSON.stringify(keys));
                if (!group) {
                    group = { keys, records: [] };
                    grouped.push(group);
                }
                group.records.push(r);
            }
        } else {
            const hasAgg = stmt.columns.some(c => /COUNT|SUM|MAX|MIN|AVG/i.test(c));
            if (hasAgg) {
                grouped = [{ keys: [], records }];
            }
        }

        const res: any[] = [];
        if (grouped.length > 0) {
            for (const g of grouped) {
                const aggRow: any = {};
                for (const col of stmt.columns) {
                    if (col === '*') continue;
                    const { alias, value } = this.evaluateColumn(col, g.records);
                    aggRow[alias] = value;
                    if (alias !== col) aggRow[col] = value;
                }
                if (!stmt.having || await this.applyWhere(aggRow, stmt.having)) {
                    res.push(aggRow);
                }
            }
            records = res;
        } else {
             records = records.map(r => {
                  const projected: any = {};
                  for (const col of stmt.columns) {
                      if (col === '*') return r;
                      const { alias, value } = this.evaluateColumn(col, [r]);
                      projected[alias] = value;
                      if (alias !== col) projected[col] = value;
                  }
                  return projected;
             });
        }
        
        if (stmt.union) {
            for (const u of stmt.union) {
                const uRes = await this.executeSelect(u);
                records.push(...uRes);
            }
            const unique = [];
            const seen = new Set();
            for (const r of records) {
                const str = JSON.stringify(r);
                if (!seen.has(str)) {
                    seen.add(str);
                    unique.push(r);
                }
            }
            records = unique;
        }

        if (stmt.offset) records = records.slice(stmt.offset);
        if (stmt.limit) records = records.slice(0, stmt.limit);

        return records;
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
                     if (await this.applyWhere(r, query.where)) {
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
                     if (await this.applyWhere(r, query.where)) {
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

    private async executeTransaction(stmt: TransactionStatement): Promise<void> {
        if (stmt.action === 'BEGIN') {
            this.inTransaction = true;
        } else if (stmt.action === 'COMMIT') {
            await this.commitWAL();
            this.inTransaction = false;
        } else if (stmt.action === 'ROLLBACK') {
            await this.wal.clear();
            this.inTransaction = false;
        } else if (stmt.action === 'SAVEPOINT' && stmt.name) {
            const entries = await this.wal.readAll();
            await this.table.saveSchema(`_sp_${stmt.name}`, { length: entries.length });
        } else if (stmt.action === 'ROLLBACK_TO' && stmt.name) {
            const meta = await this.table.getSchema(`_sp_${stmt.name}`);
            const len = meta && meta.length !== undefined ? meta.length : 0;
            const entries = await this.wal.readAll();
            if (entries.length > len) {
                await this.wal.clear();
                for (let i = 0; i < len; i++) {
                    const e = entries[i];
                    if (e) {
                        delete e.id;
                        await this.wal.append(e as any);
                    }
                }
            }
        }
    }

    private async executeCreateView(stmt: CreateViewStatement): Promise<void> {
        await this.table.saveSchema(stmt.name, { isView: true, select: stmt.select });
    }

    private async executeDropTable(stmt: DropTableStatement): Promise<void> {
        const existing = await this.table.getSchema(stmt.name);
        if (!existing && !stmt.ifExists) {
            throw new Error(`No such table: ${stmt.name}`);
        }
    }

    private async executeAlterTable(stmt: AlterTableStatement): Promise<void> {
        const schema = await this.table.getSchema(stmt.table);
        if (!schema) throw new Error(`No such table: ${stmt.table}`);

        if (stmt.action === 'ADD_COLUMN' && stmt.columnDef) {
            schema.columns = schema.columns || [];
            schema.columns.push(stmt.columnDef);
            await this.table.saveSchema(stmt.table, schema);
        } else if (stmt.action === 'RENAME_TABLE' && stmt.newName) {
            await this.table.saveSchema(stmt.newName, schema);
        } else if (stmt.action === 'RENAME_COLUMN' && stmt.oldName && stmt.newName) {
            if (schema.columns) {
                const col = schema.columns.find((c: any) => c.name === stmt.oldName);
                if (col) col.name = stmt.newName;
            }
            await this.table.saveSchema(stmt.table, schema);
        }
    }
}
