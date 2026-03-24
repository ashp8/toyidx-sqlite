import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToySQLite } from './index';

describe('ToySQLite Integrated Engine', () => {
    let db: ToySQLite;

    beforeEach(async () => {
        // We use a unique DB name per test to avoid state bleeding in memory
        const dbName = `test_db_idb_${Math.random()}`;
        db = new ToySQLite(dbName);
        await db.init();
    });

    afterEach(() => {
        db.close();
    });

    it('should create table and insert multiple rows', async () => {
        await db.execute('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(255) NOT NULL)');
        const insertResult = await db.execute("INSERT INTO users (name) VALUES ('Alice'), ('Bob')");
        expect(insertResult.length).toBe(2);
        
        const selectResult = await db.execute('SELECT * FROM users');
        expect(selectResult.length).toBe(2);
        expect(selectResult[0].name).toBe('Alice');
        expect(selectResult[1].name).toBe('Bob');
    });

    it('should filter correctly via basic WHERE clauses', async () => {
        await db.execute('CREATE TABLE items (id INTEGER, price Number)');
        await db.execute("INSERT INTO items (id, price) VALUES (1, 10), (2, 20), (3, 30), (4, 40)");

        const gtResult = await db.execute('SELECT * FROM items WHERE price > 15');
        expect(gtResult.length).toBe(3);

        const gteResult = await db.execute('SELECT * FROM items WHERE price >= 20');
        expect(gteResult.length).toBe(3);

        const ltResult = await db.execute('SELECT * FROM items WHERE price < 20');
        expect(ltResult.length).toBe(1);
        expect(ltResult[0].price).toBe(10);

        const eqResult = await db.execute('SELECT * FROM items WHERE price = 30');
        expect(eqResult.length).toBe(1);
        expect(eqResult[0].id).toBe(3);

        const neqResult = await db.execute('SELECT * FROM items WHERE price != 20');
        expect(neqResult.length).toBe(3);
    });

    it('should project specific columns', async () => {
        await db.execute('CREATE TABLE inventory (name VARCHAR, quantity Number)');
        await db.execute("INSERT INTO inventory (name, quantity) VALUES ('Apples', 5), ('Oranges', 2)");

        const selectResult = await db.execute('SELECT name FROM inventory');
        expect(selectResult.length).toBe(2);
        expect(selectResult[0].name).toBe('Apples');
        expect(selectResult[0].quantity).toBeUndefined(); 
    });

    it('should persist WAL logs to the data store on commit', async () => {
        await db.execute('CREATE TABLE cache (key VARCHAR, val VARCHAR)');
        await db.execute("INSERT INTO cache (key, val) VALUES ('A', '100')");
        
        // At this point, it's in the WAL. 
        await db.commit();
        
        const result = await db.execute("SELECT * FROM cache WHERE key = 'A'");
        expect(result.length).toBe(1);
        expect(result[0].val).toBe('100');
    });

    it('should throw an error on invalid syntax', async () => {
        await expect(db.execute('CREATE INVALID SYNTAX')).rejects.toThrow();
    });

    it('should throw an error when inserting into a non-existent table', async () => {
        await expect(db.execute("INSERT INTO missing_table (id) VALUES (1)")).rejects.toThrow(/No such table/);
    });

    it('should throw an error on unsupported queries like DELETE or UPDATE before implementation', async () => {
        await expect(db.execute("UPDATE users SET name = 'John'")).rejects.toThrow(/Unexpected token/);
    });
});
