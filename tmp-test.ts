import 'fake-indexeddb/auto';
import { Database } from './src/storage/database';
import { Executor } from './src/engine/executor';
import { Parser } from './src/parser/parser';
import { Lexer } from './src/parser/lexer';

async function run() {
    const db = new Database('test');
    await db.open();
    const exec = new Executor(db);

    const parseAndExec = async (sql: string) => {
        const parser = new Parser(new Lexer(sql));
        const stmt = parser.parse();
        return await exec.execute(stmt);
    };

    await parseAndExec('CREATE TABLE accounts (id INTEGER, balance INTEGER)');
    await parseAndExec('INSERT INTO accounts VALUES (1, 1000)');
    
    const records = await parseAndExec('SELECT * FROM accounts WHERE id = 1');
    console.log('RECORDS AFTER INSERT:', records);

    await parseAndExec('BEGIN TRANSACTION');
    await parseAndExec('UPDATE accounts SET balance = 500 WHERE id = 1');
    await parseAndExec('ROLLBACK');

    const res2 = await parseAndExec('SELECT * FROM accounts WHERE id = 1');
    console.log('RECORDS AFTER ROLLBACK:', res2);
}
run();
