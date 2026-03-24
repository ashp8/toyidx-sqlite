import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToySQLite } from '../src/index';

describe('Standard SQLite DML Roadmap', () => {
    let db: ToySQLite;

    beforeEach(async () => {
        const dbName = `test_dml_${Math.random()}`;
        db = new ToySQLite(dbName);
        await db.init();
    });

    afterEach(() => {
        db.close();
    });

    it('should support INSERT OR IGNORE / REPLACE', async () => {
        await db.execute('CREATE TABLE keys (k VARCHAR UNIQUE)');
        await db.execute("INSERT INTO keys (k) VALUES ('a')");
        await db.execute("INSERT OR IGNORE INTO keys (k) VALUES ('a')"); // should not error
        await db.execute("INSERT OR REPLACE INTO keys (k) VALUES ('a')");
    });

    it('should support INSERT INTO ... SELECT', async () => {
        await db.execute('CREATE TABLE source (val INTEGER)');
        await db.execute('CREATE TABLE dest (val INTEGER)');
        await db.execute('INSERT INTO source (val) VALUES (1), (2)');
        await db.execute('INSERT INTO dest (val) SELECT val FROM source');
    });

    it('should support UPDATE with advanced clauses', async () => {
        await db.execute('CREATE TABLE records (id INTEGER, status VARCHAR, score INTEGER)');
        await db.execute("UPDATE records SET status = 'pass' WHERE score >= 50 AND status IS NULL");
    });

    it('should support complex DELETE queries', async () => {
        await db.execute('CREATE TABLE cache (key VARCHAR, expiry INTEGER)');
        await db.execute("DELETE FROM cache WHERE expiry < 1000 OR key LIKE 'temp_%'");
    });

    it('should support RETURNING clause', async () => {
        await db.execute('CREATE TABLE users (id INTEGER, name VARCHAR)');
        const res = await db.execute("INSERT INTO users (id, name) VALUES (1, 'Alice') RETURNING id");
        expect(res.length).toBe(1);
        expect(res[0].id).toBe(1);
    });
});
