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

    public async insertRecord(tableName: string, rowId: number | string, record: any): Promise<void> {
        return new Promise((resolve, reject) => {
            const tx = this.db.getDB().transaction('_data', 'readwrite');
            const store = tx.objectStore('_data');
            const request = store.put(record, [tableName, rowId]);
            request.onsuccess = () => resolve();
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
}
