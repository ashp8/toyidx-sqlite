import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToySQLite } from '../src/index';
import { Lexer } from '../src/parser/lexer';
import { Parser } from '../src/parser/parser';

describe('Performance Comparison: TS vs Wasm', () => {
    let tsDb: ToySQLite;
    let wasmDb: ToySQLite;

    beforeEach(async () => {
        tsDb = new ToySQLite(`ts_perf_${Math.random()}`, 1, { useWasm: false });
        wasmDb = new ToySQLite(`wasm_perf_${Math.random()}`, 1, { useWasm: true });
        await tsDb.init();
        await wasmDb.init();
    });

    afterEach(() => {
        tsDb.close();
        wasmDb.close();
    });

    async function seedData(db1: ToySQLite, db2: ToySQLite, count: number) {
        await db1.execute('CREATE TABLE perf_test (id INTEGER PRIMARY KEY, val INTEGER, name VARCHAR)');
        await db2.execute('CREATE TABLE perf_test (id INTEGER PRIMARY KEY, val INTEGER, name VARCHAR)');
        for (let i = 0; i < count; i++) {
             const val = Math.floor(Math.random() * 1000);
             const sql = `INSERT INTO perf_test (id, val, name) VALUES (${i}, ${val}, 'item_${i}')`;
             await db1.execute(sql);
             await db2.execute(sql);
        }
    }

    it('should compare execution speed for a large SELECT', async () => {
        const rowCount = 2000;
        console.log(`Seeding ${rowCount} rows...`);
        await seedData(tsDb, wasmDb, rowCount);

        const query = 'SELECT * FROM perf_test WHERE val > 500';

        console.log('Running TS query...');
        const startTs = performance.now();
        const resTs = await tsDb.execute(query);
        const endTs = performance.now();
        const tsTime = endTs - startTs;

        console.log('Running Wasm query...');
        const startWasm = performance.now();
        const resWasm = await wasmDb.execute(query);
        const endWasm = performance.now();
        const wasmTime = endWasm - startWasm;

        console.log(`Results: TS = ${tsTime.toFixed(2)}ms, Wasm = ${wasmTime.toFixed(2)}ms`);
        console.log(`Wasm is ${(tsTime / wasmTime).toFixed(2)}x faster`);
        
        expect(resTs).toEqual(resWasm);
    }, 60000);

    it('should compare parsing speed for complex queries', async () => {
        const complexQuery = 'SELECT a, b, c FROM table1 INNER JOIN table2 ON table1.id = table2.id WHERE a > 10 AND b < 20 OR c = "test"';
        const iterations = 1000;

        console.log(`Parsing query ${iterations} times...`);
        
        // Use a mock/internal method to test JUST parsing if possible, or just execute and ignore result
        // Since we want to test Wasm vs TS parsing, we can just use the Lexer/Parser directly
        
        const startTs = performance.now();
        for (let i = 0; i < iterations; i++) {
            const lex = new Lexer(complexQuery);
            const par = new Parser(lex);
            par.parse();
        }
        const endTs = performance.now();
        const tsTime = endTs - startTs;

        // For Wasm, we need to ensure we init first
        await wasmDb.init();
        const wasmModule = (wasmDb as any).wasmModule;
        
        const startWasm = performance.now();
        for (let i = 0; i < iterations; i++) {
            const lex = new wasmModule.Lexer(complexQuery);
            const par = new wasmModule.Parser(lex);
            const stmt = par.parse();
            lex.delete();
            par.delete();
            stmt.delete();
        }
        const endWasm = performance.now();
        const wasmTime = endWasm - startWasm;

        console.log(`Parsing Results: TS = ${tsTime.toFixed(2)}ms, Wasm = ${wasmTime.toFixed(2)}ms`);
        console.log(`Wasm Parsing is ${(tsTime / wasmTime).toFixed(2)}x faster`);
        
        expect(wasmTime).toBeLessThan(tsTime);
    });
});
