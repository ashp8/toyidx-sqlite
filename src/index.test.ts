import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToySQLite } from './index';

describe('ToySQLite Integrated Engine', () => {
    let db: ToySQLite;

    beforeEach(async () => {
        db = new ToySQLite('test_db_idb');
        await db.init();
    });

    afterEach(() => {
        db.close();
    });

    it('should create table, insert multiple rows, and select all records', async () => {
        await db.execute('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(255) NOT NULL)');
        
        const insertResult = await db.execute("INSERT INTO users (name) VALUES ('Alice'), ('Bob')");
        // returns the rowids generated
        expect(insertResult.length).toBe(2);

        const selectResult = await db.execute('SELECT * FROM users');
        expect(selectResult.length).toBe(2);
        expect(selectResult[0].name).toBe('Alice');
        expect(selectResult[1].name).toBe('Bob');
    });

    it('should filter correctly via basic WHERE clauses', async () => {
        await db.execute('CREATE TABLE items (id INTEGER, price Number)');
        await db.execute("INSERT INTO items (id, price) VALUES (1, 10), (2, 20), (3, 30)");

        const selectResult = await db.execute('SELECT * FROM items WHERE price > 15');
        
        expect(selectResult.length).toBe(2);
        expect(selectResult[0].price).toBe(20);
        expect(selectResult[1].price).toBe(30);
    });

    it('should project specific columns', async () => {
        await db.execute('CREATE TABLE inventory (name VARCHAR, quantity Number)');
        await db.execute("INSERT INTO inventory (name, quantity) VALUES ('Apples', 5), ('Oranges', 2)");

        // Select only the 'name' column
        const selectResult = await db.execute('SELECT name FROM inventory');
        
        expect(selectResult.length).toBe(2);
        expect(selectResult[0].name).toBe('Apples');
        expect(selectResult[0].quantity).toBeUndefined(); // ensure projection strips other fields!
    });
});
