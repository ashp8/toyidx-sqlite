import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToySQLite } from '../src/index';

describe('Standard SQLite DDL Roadmap', () => {
    let db: ToySQLite;

    beforeEach(async () => {
        const dbName = `test_ddl_${Math.random()}`;
        db = new ToySQLite(dbName);
        await db.init();
    });

    afterEach(() => {
        db.close();
    });

    it('should support CREATE TABLE IF NOT EXISTS', async () => {
        await db.execute('CREATE TABLE IF NOT EXISTS ddl_test (id INTEGER)');
    });

    it('should support strict constraints and default values', async () => {
        await db.execute(`
            CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email VARCHAR(255) NOT NULL UNIQUE,
                status VARCHAR DEFAULT 'active',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                age INTEGER CHECK(age >= 18)
            )
        `);
    });

    it('should support DROP TABLE and DROP TABLE IF EXISTS', async () => {
        await db.execute('CREATE TABLE temp_table (id INTEGER)');
        await db.execute('DROP TABLE temp_table');
        await db.execute('DROP TABLE IF EXISTS unknown_table');
    });

    it('should support ALTER TABLE ADD COLUMN', async () => {
        await db.execute('CREATE TABLE alter_test (id INTEGER)');
        await db.execute('ALTER TABLE alter_test ADD COLUMN name VARCHAR');
    });

    it('should support ALTER TABLE RENAME', async () => {
        await db.execute('CREATE TABLE old_name (id INTEGER)');
        await db.execute('ALTER TABLE old_name RENAME TO new_name');
        await db.execute('ALTER TABLE new_name RENAME COLUMN id TO user_id');
    });

    it('should support CREATE VIEW', async () => {
        await db.execute('CREATE TABLE data (val INTEGER)');
        await db.execute('CREATE VIEW data_view AS SELECT val FROM data WHERE val > 10');
    });
});
