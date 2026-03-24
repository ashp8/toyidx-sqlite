# toyindx-sqlite

A lightweight, purely client-side SQL engine built on top of IndexedDB. It parses and executes standard SQLite syntax directly in the browser, providing a familiar relational database experience without requiring WebSQL or WebAssembly.

Built with performance in mind, `toyindx-sqlite` supports Write-Ahead Logging (WAL) for fast inserts, native IndexedDB B-tree integration for `WHERE` clause lookups, and highly optimized `$O(N+M)$` Hash Joins.

## Installation

```bash
npm install toyindx-sqlite
# or
pnpm add toyindx-sqlite
# or
yarn add toyindx-sqlite
```

## Basic Usage

The primary interface for this library is the `ToySQLite` class. 

### 1. Initialization

Import the class and initialize it with your desired database name and version.

```typescript
import { ToySQLite } from 'toyindx-sqlite';

// Initialize with a database name and version number
const db = new ToySQLite('my_app_database', 1);

// You must call init() to open the IndexedDB connection before running queries
await db.init();
```

### 2. Executing Queries

Use the `execute()` method to run standard SQL commands. The engine automatically handles transactions and writes to the underlying IndexedDB storage.

```typescript
// Create tables and indices
await db.execute(`
    CREATE TABLE users (
        id INTEGER PRIMARY KEY, 
        name STRING, 
        email STRING UNIQUE
    )
`);
await db.execute('CREATE INDEX idx_user_email ON users (email)');

// Insert data
await db.execute(`INSERT INTO users VALUES (1, 'Alice', 'alice@example.com')`);
await db.execute(`INSERT INTO users VALUES (2, 'Bob', 'bob@example.com')`);

// Query data
const users = await db.execute(`SELECT * FROM users WHERE id = 1`);
console.log(users); // [{ id: 1, name: 'Alice', email: 'alice@example.com' }]
```

### 3. Transactions

For bulk operations, wrap your inserts or updates in a transaction to significantly boost performance. The engine batches these changes in a Write-Ahead Log (WAL) and flushes them to IndexedDB concurrently upon `COMMIT`.

```typescript
await db.execute('BEGIN TRANSACTION');

for (let i = 0; i < 1000; i++) {
    await db.execute(`INSERT INTO users VALUES (${i + 10}, 'User ${i}', 'user${i}@example.com')`);
}

await db.execute('COMMIT');
```

## Supported SQL Features

* `CREATE TABLE` (including `PRIMARY KEY`, `UNIQUE`, `DEFAULT`, `REFERENCES`)
* `CREATE INDEX` / `DROP INDEX`
* `INSERT` (including `INSERT OR IGNORE`, `INSERT OR REPLACE`, `RETURNING`)
* `SELECT` (including `JOIN`, `LEFT JOIN`, `WHERE`, `GROUP BY`, `HAVING`, `LIMIT`, `OFFSET`, `UNION`)
* `UPDATE` / `DELETE`
* `BEGIN` / `COMMIT` / `ROLLBACK` / `SAVEPOINT`
* `ALTER TABLE` (including `ADD COLUMN`, `RENAME TO`)
* `CREATE VIEW`

## Cleanup

When you are done interacting with the database, close the connection to prevent memory leaks:

```typescript
db.close();
```
