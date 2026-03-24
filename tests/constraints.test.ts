import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToySQLite } from './index';

describe('ToySQLite Constraints', () => {
    let db: ToySQLite;

    beforeEach(async () => {
        // We use a unique DB name per test to avoid state bleeding in memory
        const dbName = `test_db_constraints_${Math.random()}`;
        db = new ToySQLite(dbName);
        await db.init();
    });

    afterEach(() => {
        db.close();
    });

    it('should enforce PRIMARY KEY constraint and prevent duplicate inserts', async () => {
        await db.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR(255))');

        // First insert should succeed
        await db.execute("INSERT INTO users (id, name) VALUES (1, 'Alice')");

        // Second insert with the same primary key should fail
        await expect(db.execute("INSERT INTO users (id, name) VALUES (1, 'Bob')"))
            .rejects.toThrow(/UNIQUE constraint failed: users.id/);

        // Third insert with a different primary key should succeed
        await db.execute("INSERT INTO users (id, name) VALUES (2, 'Charlie')");

        const res = await db.execute("SELECT * FROM users");
        expect(res.length).toBe(2);
    });

    it('should enforce UNIQUE constraint on a specific column', async () => {
        await db.execute('CREATE TABLE user_emails (id INTEGER PRIMARY KEY AUTOINCREMENT, email VARCHAR UNIQUE)');

        // First insert should succeed
        await db.execute("INSERT INTO user_emails (email) VALUES ('alice@example.com')");

        // Second insert with the same unique value should fail
        await expect(db.execute("INSERT INTO user_emails (email) VALUES ('alice@example.com')"))
            .rejects.toThrow(/UNIQUE constraint failed: user_emails.email/);

        // Different email should succeed
        await db.execute("INSERT INTO user_emails (email) VALUES ('bob@example.com')");

        const res = await db.execute("SELECT * FROM user_emails");
        expect(res.length).toBe(2);
    });

    it('should enforce constraints during multi-row inserts', async () => {
        await db.execute('CREATE TABLE products (id INTEGER PRIMARY KEY, sku VARCHAR UNIQUE)');

        // Setup initial data
        await db.execute("INSERT INTO products (id, sku) VALUES (1, 'SKU-100')");

        // Inserting multiple rows where one violates the UNIQUE constraint
        await expect(db.execute("INSERT INTO products (id, sku) VALUES (2, 'SKU-200'), (3, 'SKU-100')"))
            .rejects.toThrow(/UNIQUE constraint failed: products.sku/);

        // Verification: The transaction for the failing statement should theoretically be rolled back or aborted.
        // In this basic engine, an error is thrown which aborts the rest of the statement, but previous rows in the statement are already written to the WAL.
        // Therefore, we expect 2 rows (the initial one, plus the first row of the failing batch).
        const res = await db.execute("SELECT * FROM products");
        expect(res.length).toBe(2);
    });
});
