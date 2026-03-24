require('fake-indexeddb/auto');
const { ToySQLite } = require('./dist/index.js');

async function main() {
    // First run (app load 1)
    const db1 = new ToySQLite('test_db_angular');
    await db1.init();
    await db1.execute('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)');
    await db1.execute("INSERT INTO users (id, name, email) VALUES (1, 'John Doe', 'email@email.com')");
    await db1.commit();
    db1.close();
    console.log("Run 1 complete.");

    // Second run (app load 2)
    const db2 = new ToySQLite('test_db_angular');
    await db2.init();
    await db2.execute('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)');
    try {
        await db2.execute("INSERT INTO users (id, name, email) VALUES (1, 'John Doe', 'email@email.com')");
        await db2.commit();
        console.log("Run 2 complete - error did NOT throw. Constraint failed to enforce!");
        
        const res = await db2.execute("SELECT * FROM users");
        console.log("Rows in DB:", res);
    } catch (e) {
        console.log("Run 2 failed as expected:", e.message);
    }
    db2.close();
}

main().catch(console.error);
