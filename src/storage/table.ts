import { Database } from "./database";

export class TableManager {
    constructor(private db: Database) {}

    public async getNextRowId(tableName: string): Promise<number> {
        return new Promise((resolve, reject) => {
            const tx = this.db.getDB().transaction('_metadata', 'readwrite');
            const store = tx.objectStore('_metadata');
            const request = store.get(`seq_${tableName}`);
            
            request.onsuccess = () => {
                const current = request.result || 0;
                const next = current + 1;
                store.put(next, `seq_${tableName}`);
                resolve(next);
            };
            request.onerror = () => reject(request.error);
        });
    }

    public async updateSeqIfHigher(tableName: string, value: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const tx = this.db.getDB().transaction('_metadata', 'readwrite');
            const store = tx.objectStore('_metadata');
            const request = store.get(`seq_${tableName}`);
            
            request.onsuccess = () => {
                const current = request.result || 0;
                if (value > current) {
                    store.put(value, `seq_${tableName}`);
                }
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    public async insertRecord(tableName: string, rowId: number | string, record: any): Promise<void> {
        return new Promise((resolve, reject) => {
            const tx = this.db.getDB().transaction('_data', 'readwrite');
            const store = tx.objectStore('_data');
            const request = store.put(record, [tableName, rowId]);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    public async bulkInsertRecords(tableName: string, records: any[]): Promise<void> {
        return new Promise((resolve, reject) => {
            const tx = this.db.getDB().transaction('_data', 'readwrite');
            const store = tx.objectStore('_data');
            let completed = 0;
            if (records.length === 0) return resolve();
            for (let i = 0; i < records.length; i++) {
                const request = store.put(records[i], [tableName, records[i]._rowid]);
                request.onsuccess = () => {
                    if (++completed === records.length) resolve();
                };
                request.onerror = () => reject(request.error);
            }
        });
    }

    public async deleteRecord(tableName: string, rowId: number | string): Promise<void> {
        return new Promise((resolve, reject) => {
            const tx = this.db.getDB().transaction('_data', 'readwrite');
            const store = tx.objectStore('_data');
            const request = store.delete([tableName, rowId]);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    public async scanTable(
        tableName: string,
        callback: (record: any) => boolean | Promise<boolean>
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const tx = this.db.getDB().transaction('_data', 'readonly');
            const store = tx.objectStore('_data');
            const range = IDBKeyRange.bound([tableName, -Infinity], [tableName, Infinity]);
            const request = store.openCursor(range);
            
            request.onsuccess = async (event: any) => {
                const cursor = event.target.result;
                if (cursor) {
                    const shouldContinue = await callback(cursor.value);
                    if (shouldContinue) {
                        cursor.continue();
                    } else {
                        resolve();
                    }
                } else {
                    resolve();
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    public async getRecordById(tableName: string, rowId: number | string): Promise<any> {
        return new Promise((resolve, reject) => {
            const tx = this.db.getDB().transaction('_data', 'readonly');
            const store = tx.objectStore('_data');
            const request = store.get([tableName, rowId]);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    public async getAllRecords(tableName: string): Promise<any[]> {
        return new Promise((resolve, reject) => {
            const tx = this.db.getDB().transaction('_data', 'readonly');
            const store = tx.objectStore('_data');
            
            // Fetch records by bound array keys
            if (typeof indexedDB !== 'undefined') {
                 // Adjusting bounds for IDB
                const range = IDBKeyRange.bound([tableName, -Infinity], [tableName, Infinity]);
                const request = store.getAll(range);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            } else {
                resolve([]);
            }
        });
    }
    
    public async saveSchema(tableName: string, schema: any): Promise<void> {
        return new Promise((resolve, reject) => {
            const tx = this.db.getDB().transaction('_metadata', 'readwrite');
            const store = tx.objectStore('_metadata');
            const request = store.put(schema, `schema_${tableName}`);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    public async getSchema(tableName: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const tx = this.db.getDB().transaction('_metadata', 'readonly');
            const store = tx.objectStore('_metadata');
            const request = store.get(`schema_${tableName}`);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    public async addIndexEntry(tableName: string, indexName: string, indexValue: any, rowId: number | string): Promise<void> {
        return new Promise((resolve, reject) => {
            const tx = this.db.getDB().transaction('_indexes', 'readwrite');
            const store = tx.objectStore('_indexes');
            const key = [tableName, indexName, indexValue];
            const getReq = store.get(key);
            getReq.onsuccess = () => {
                 const current = getReq.result || [];
                 if (!current.includes(rowId)) current.push(rowId);
                 const putReq = store.put(current, key);
                 putReq.onsuccess = () => resolve();
                 putReq.onerror = () => reject(putReq.error);
            };
            getReq.onerror = () => reject(getReq.error);
        });
    }

    public async removeIndexEntry(tableName: string, indexName: string, indexValue: any, rowId: number | string): Promise<void> {
        return new Promise((resolve, reject) => {
            const tx = this.db.getDB().transaction('_indexes', 'readwrite');
            const store = tx.objectStore('_indexes');
            const key = [tableName, indexName, indexValue];
            const getReq = store.get(key);
            getReq.onsuccess = () => {
                 let current: any[] = getReq.result || [];
                 current = current.filter(id => id !== rowId);
                 if (current.length === 0) {
                     store.delete(key).onsuccess = () => resolve();
                 } else {
                     store.put(current, key).onsuccess = () => resolve();
                 }
            };
            getReq.onerror = () => reject(getReq.error);
        });
    }

    public async getRowsByIndex(tableName: string, indexName: string, indexValue: any): Promise<any[]> {
        return new Promise((resolve, reject) => {
            const tx = this.db.getDB().transaction(['_indexes', '_data'], 'readonly');
            const idxStore = tx.objectStore('_indexes');
            const key = [tableName, indexName, indexValue];
            const getReq = idxStore.get(key);
            getReq.onsuccess = () => {
                 const rowIds: any[] = getReq.result || [];
                 if (rowIds.length === 0) return resolve([]);
                 
                 const dataStore = tx.objectStore('_data');
                 const rows: any[] = [];
                 let completed = 0;
                 for (const id of rowIds) {
                     const rowReq = dataStore.get([tableName, id]);
                     rowReq.onsuccess = () => {
                         if (rowReq.result) rows.push(rowReq.result);
                         if (++completed === rowIds.length) resolve(rows);
                     };
                     rowReq.onerror = () => reject(rowReq.error);
                 }
            };
            getReq.onerror = () => reject(getReq.error);
        });
    }
}
