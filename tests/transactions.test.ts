import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToySQLite } from '../src/index';

describe('Standard SQLite Transactions Roadmap', () => {
    let db: ToySQLite;

    beforeEach(async () => {
        const dbName = `test_txn_${Math.random()}`;
        db = new ToySQLite(dbName);
        await db.init();
    });

    afterEach(() => {
        db.close();
    });

    it('should support explicit BEGIN TRANSACTION and COMMIT boundaries', async () => {
        await db.execute('CREATE TABLE accounts (id INTEGER, balance INTEGER)');
        await db.execute('BEGIN TRANSACTION');
        await db.execute('INSERT INTO accounts VALUES (1, 1000)');
        await db.execute('INSERT INTO accounts VALUES (2, 2000)');
        await db.execute('COMMIT');
    });

    it('should support ROLLBACK and reverting changes', async () => {
        await db.execute('CREATE TABLE accounts (id INTEGER, balance INTEGER)');
        await db.execute('INSERT INTO accounts VALUES (1, 1000)');
        
        await db.execute('BEGIN TRANSACTION');
        await db.execute('UPDATE accounts SET balance = 500 WHERE id = 1');
        await db.execute('ROLLBACK');

        const res = await db.execute('SELECT balance FROM accounts WHERE id = 1');
        expect(res[0].balance).toBe(1000);
    });

    it('should support SAVEPOINT and ROLLBACK TO SAVEPOINT', async () => {
        await db.execute('CREATE TABLE queue (id INTEGER)');
        await db.execute('BEGIN TRANSACTION');
        await db.execute('INSERT INTO queue VALUES (1)');
        await db.execute('SAVEPOINT sp1');
        await db.execute('INSERT INTO queue VALUES (2)');
        await db.execute('ROLLBACK TO SAVEPOINT sp1');
        await db.execute('COMMIT');

        const res = await db.execute('SELECT count(*) as c FROM queue');
        expect(res[0].c).toBe(1);
    });
});
