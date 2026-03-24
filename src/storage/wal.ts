import { Database } from "./database";

export interface WALEntry {
    id?: number;
    type: 'INSERT' | 'UPDATE' | 'DELETE' | 'CREATE_TABLE';
    table: string;
    payload: any;
    timestamp: number;
}

export class WAL {
    constructor(private db: Database) {}

    public async append(entry: Omit<WALEntry, 'id' | 'timestamp'>): Promise<number> {
        return new Promise((resolve, reject) => {
            const tx = this.db.getDB().transaction('_wal', 'readwrite');
            const store = tx.objectStore('_wal');
            const fullEntry: WALEntry = {
                ...entry,
                timestamp: Date.now()
            };
            const request = store.add(fullEntry);
            
            request.onsuccess = () => resolve(request.result as number);
            request.onerror = () => reject(request.error);
        });
    }

    public async readAll(): Promise<WALEntry[]> {
        return new Promise((resolve, reject) => {
            const tx = this.db.getDB().transaction('_wal', 'readonly');
            const store = tx.objectStore('_wal');
            const request = store.getAll();
            
            request.onsuccess = () => {
                const entries = request.result;
                resolve(entries);
            };
            request.onerror = () => reject(request.error);
        });
    }

    public async clear(): Promise<void> {
        return new Promise((resolve, reject) => {
            const tx = this.db.getDB().transaction('_wal', 'readwrite');
            const store = tx.objectStore('_wal');
            const request = store.clear();
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}
