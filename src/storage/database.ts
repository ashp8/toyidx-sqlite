export class Database {
    private dbName: string;
    private version: number;
    private db: IDBDatabase | null = null;

    constructor(dbName: string, version: number = 1) {
        this.dbName = dbName;
        this.version = version;
    }

    public async open(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
                const db = (event.target as IDBOpenDBRequest).result;
                
                // The global Write-Ahead Log store
                // We'll use autoIncrement keys for chronological ordering
                if (!db.objectStoreNames.contains('_wal')) {
                    db.createObjectStore('_wal', { autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('_data')) {
                    db.createObjectStore('_data');
                }
                if (!db.objectStoreNames.contains('_metadata')) {
                    db.createObjectStore('_metadata');
                }
                if (!db.objectStoreNames.contains('_indexes')) {
                    db.createObjectStore('_indexes');
                }
            };

            request.onsuccess = (event: Event) => {
                this.db = (event.target as IDBOpenDBRequest).result;
                resolve();
            };

            request.onerror = (event: Event) => {
                reject((event.target as IDBOpenDBRequest).error);
            };
        });
    }

    public getDB(): IDBDatabase {
        if (!this.db) throw new Error("Database not open. Call open() first.");
        return this.db;
    }

    public close(): void {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}
