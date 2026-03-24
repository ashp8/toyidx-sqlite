import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToySQLite } from '../src/index';

describe('Standard SQLite SELECT Roadmap', () => {
    let db: ToySQLite;

    beforeEach(async () => {
        const dbName = `test_select_${Math.random()}`;
        db = new ToySQLite(dbName);
        await db.init();
    });

    afterEach(() => {
        db.close();
    });

    it('should support aggregate functions (COUNT, SUM, MAX, MIN, AVG)', async () => {
        await db.execute('CREATE TABLE stats (val INTEGER)');
        await db.execute('INSERT INTO stats (val) VALUES (10), (20), (30)');
        const res = await db.execute('SELECT COUNT(*), SUM(val), MAX(val), MIN(val), AVG(val) FROM stats');
        expect(res[0]['COUNT(*)']).toBe(3);
    });

    it('should support GROUP BY and HAVING filters', async () => {
        await db.execute('CREATE TABLE employees (dept VARCHAR, salary INTEGER)');
        await db.execute("INSERT INTO employees VALUES ('IT', 5000), ('IT', 6000), ('HR', 4000)");
        await db.execute('SELECT dept, SUM(salary) as total FROM employees GROUP BY dept HAVING total > 4500');
    });

    it('should support JOIN operations (INNER, LEFT, CROSS)', async () => {
        await db.execute('CREATE TABLE users (id INTEGER, name VARCHAR)');
        await db.execute('CREATE TABLE orders (id INTEGER, user_id INTEGER, amount INTEGER)');
        await db.execute("INSERT INTO users VALUES (1, 'Alice'), (2, 'Bob')");
        await db.execute("INSERT INTO orders VALUES (101, 1, 50)");
        await db.execute('SELECT users.name, orders.amount FROM users INNER JOIN orders ON users.id = orders.user_id');
    });

    it('should support set operations (UNION, UNION ALL)', async () => {
        await db.execute('CREATE TABLE t1 (val INTEGER)');
        await db.execute('CREATE TABLE t2 (val INTEGER)');
        await db.execute('INSERT INTO t1 VALUES (1), (2)');
        await db.execute('INSERT INTO t2 VALUES (2), (3)');
        await db.execute('SELECT val FROM t1 UNION SELECT val FROM t2');
    });

    it('should support subqueries in WHERE and FROM clauses', async () => {
        await db.execute('CREATE TABLE products (id INTEGER, price INTEGER)');
        await db.execute('INSERT INTO products VALUES (1, 100), (2, 200), (3, 300)');
        await db.execute('SELECT * FROM products WHERE price > (SELECT AVG(price) FROM products)');
    });

    it('should support LIKE, IN, BETWEEN, and IS NULL operators', async () => {
        await db.execute('CREATE TABLE text_data (name VARCHAR, score INTEGER, ref VARCHAR)');
        await db.execute("INSERT INTO text_data VALUES ('Alice', 10, NULL), ('Bob', 20, 'a'), ('Charlie', 30, 'b')");
        await db.execute("SELECT * FROM text_data WHERE name LIKE 'A%' AND score BETWEEN 5 AND 15");
        await db.execute("SELECT * FROM text_data WHERE score IN (10, 30)");
        await db.execute("SELECT * FROM text_data WHERE ref IS NULL");
    });
});
