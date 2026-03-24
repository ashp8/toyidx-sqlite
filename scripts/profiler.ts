import 'fake-indexeddb/auto';
import { performance } from 'perf_hooks';
import { ToySQLite } from '../src/index';

async function measure(name: string, fn: () => Promise<void> | void) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    return end - start;
}

async function runBenchmark() {
    console.log('--- ToySQLite Profiler ---');
    console.log(`Starting profiling at ${new Date().toISOString()}`);
    const dbName = `bench_${Date.now()}`;
    const db = new ToySQLite(dbName);
    
    // 1. Initialization
    let time = await measure('Initialization', async () => {
        await db.init();
    });
    const results = [{ Operation: 'Initialization', 'Time (ms)': time.toFixed(2), Details: 'init() call' }];

    // 2. DDL: Create Table
    time = await measure('Create Table', async () => {
        await db.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, age INTEGER, active INTEGER)');
        await db.execute('CREATE INDEX idx_age ON users(age)');
    });
    results.push({ Operation: 'Create Table & Index', 'Time (ms)': time.toFixed(2), Details: '5 columns, 1 index' });

    // 3. Bulk Insert
    const ROW_COUNT = 1000;
    time = await measure(`Bulk Insert (${ROW_COUNT} rows)`, async () => {
        await db.execute('BEGIN TRANSACTION');
        for (let i = 0; i < ROW_COUNT; i++) {
            await db.execute(`INSERT INTO users VALUES (${i}, 'User${i}', 'user${i}@example.com', ${20 + (i % 50)}, ${i % 2})`);
        }
        await db.execute('COMMIT');
    });
    results.push({ Operation: 'Bulk Insert', 'Time (ms)': time.toFixed(2), Details: `${ROW_COUNT} rows in 1 transaction` });

    // 4. Full Table Scan (Select All)
    time = await measure('Full Table Scan (SELECT *)', async () => {
        const res = await db.execute('SELECT * FROM users');
        if (res.length !== ROW_COUNT) {
            console.warn(`Warning: Expected ${ROW_COUNT} rows, got ${res.length}`);
        }
    });
    results.push({ Operation: 'Full Table Scan', 'Time (ms)': time.toFixed(2), Details: `Scan all rows` });

    // 5. Select with WHERE
    time = await measure('Select with WHERE', async () => {
        await db.execute('SELECT count(*) as c FROM users WHERE age = 30 AND active = 1');
    });
    results.push({ Operation: 'Select with WHERE', 'Time (ms)': time.toFixed(2), Details: `Using AND constraint` });

    // 6. Update Rows
    time = await measure('Bulk Update', async () => {
        await db.execute('BEGIN TRANSACTION');
        await db.execute('UPDATE users SET active = 0 WHERE age > 40');
        await db.execute('COMMIT');
    });
    results.push({ Operation: 'Bulk Update', 'Time (ms)': time.toFixed(2), Details: `Update records matching WHERE` });

    // 7. Savepoint & Rollback
    time = await measure('SAVEPOINT Operations', async () => {
        await db.execute('BEGIN TRANSACTION');
        await db.execute(`INSERT INTO users VALUES (99999, 'TempUser', 'temp@example.com', 99, 1)`);
        await db.execute('SAVEPOINT sp1');
        await db.execute(`INSERT INTO users VALUES (100000, 'TempUser2', 'temp2@example.com', 99, 1)`);
        await db.execute('ROLLBACK TO SAVEPOINT sp1');
        await db.execute('COMMIT');
    });
    results.push({ Operation: 'SAVEPOINT / ROLLBACK', 'Time (ms)': time.toFixed(2), Details: `Insert, Savepoint, Insert, Rollback` });

    // 8. Delete Rows
    time = await measure('Delete Rows', async () => {
        await db.execute('BEGIN TRANSACTION');
        await db.execute('DELETE FROM users WHERE age = 25');
        await db.execute('COMMIT');
    });
    results.push({ Operation: 'Delete', 'Time (ms)': time.toFixed(2), Details: `Delete records matching WHERE` });

    console.table(results);
    db.close();
}

runBenchmark().catch(console.error);
