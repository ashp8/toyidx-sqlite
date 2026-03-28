import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToySQLite } from '../src/index';

/**
 * Comprehensive benchmark: TS vs WASM at different data sizes.
 * Tests: full scan, filtered scan, COUNT, projection, LIMIT.
 */
describe('Comprehensive TS vs WASM Benchmark', () => {
    const ROW_COUNTS = [100, 500, 2000, 10000, 50000];

    for (const rowCount of ROW_COUNTS) {
        describe(`${rowCount} rows`, () => {
            let tsDb: ToySQLite;
            let wasmDb: ToySQLite;

            beforeEach(async () => {
                tsDb = new ToySQLite(`ts_bench_${rowCount}_${Math.random()}`, 1, { useWasm: false });
                wasmDb = new ToySQLite(`wasm_bench_${rowCount}_${Math.random()}`, 1, { useWasm: true });
                await tsDb.init();
                await wasmDb.init();

                // Seed data into both DBs
                const batchSQL = (db: ToySQLite) => db.execute(
                    'CREATE TABLE bench (id INTEGER PRIMARY KEY, val INTEGER, name VARCHAR, score INTEGER, active INTEGER)'
                );
                await batchSQL(tsDb);
                await batchSQL(wasmDb);

                // Batch insert for speed  
                await tsDb.execute('BEGIN TRANSACTION');
                await wasmDb.execute('BEGIN TRANSACTION');
                for (let i = 0; i < rowCount; i++) {
                    const val = Math.floor(Math.random() * 1000);
                    const score = Math.floor(Math.random() * 100);
                    const sql = `INSERT INTO bench (id, val, name, score, active) VALUES (${i}, ${val}, 'item_${i}', ${score}, ${i % 2})`;
                    await tsDb.execute(sql);
                    await wasmDb.execute(sql);
                }
                await tsDb.execute('COMMIT');
                await wasmDb.execute('COMMIT');
            }, 120000);

            afterEach(() => {
                tsDb.close();
                wasmDb.close();
            });

            async function benchmark(label: string, query: string) {
                // Warm-up run (especially for WASM init)
                await tsDb.execute(query);
                await wasmDb.execute(query);

                const ITERATIONS = 3;
                let tsTotal = 0, wasmTotal = 0;
                let tsRes: any, wasmRes: any;

                for (let i = 0; i < ITERATIONS; i++) {
                    const t0 = performance.now();
                    tsRes = await tsDb.execute(query);
                    tsTotal += performance.now() - t0;

                    const t1 = performance.now();
                    wasmRes = await wasmDb.execute(query);
                    wasmTotal += performance.now() - t1;
                }

                const tsAvg = tsTotal / ITERATIONS;
                const wasmAvg = wasmTotal / ITERATIONS;
                const ratio = tsAvg / wasmAvg;

                console.log(
                    `[${rowCount} rows] ${label}: TS=${tsAvg.toFixed(2)}ms, WASM=${wasmAvg.toFixed(2)}ms, ` +
                    `ratio=${ratio.toFixed(2)}x ${ratio > 1 ? '(WASM faster)' : '(TS faster)'}`
                );

                return { tsAvg, wasmAvg, ratio, tsRes, wasmRes };
            }

            it('full scan: SELECT *', async () => {
                const { tsRes, wasmRes } = await benchmark('SELECT *', 'SELECT * FROM bench');
                expect(tsRes.length).toBe(rowCount);
                expect(wasmRes.length).toBe(rowCount);
            }, 120000);

            it('filtered: WHERE val > 500', async () => {
                const { tsRes, wasmRes } = await benchmark('WHERE val > 500', 'SELECT * FROM bench WHERE val > 500');
                expect(tsRes.length).toBe(wasmRes.length);
            }, 120000);

            it('highly selective: WHERE val = 42', async () => {
                const { tsRes, wasmRes } = await benchmark('WHERE val = 42', 'SELECT * FROM bench WHERE val = 42');
                expect(tsRes.length).toBe(wasmRes.length);
            }, 120000);

            it('projection: SELECT id, val', async () => {
                const { tsRes, wasmRes } = await benchmark('Projection', 'SELECT id, val FROM bench');
                expect(tsRes.length).toBe(rowCount);
                expect(wasmRes.length).toBe(rowCount);
            }, 120000);

            it('COUNT(*)', async () => {
                const { tsRes, wasmRes } = await benchmark('COUNT(*)', 'SELECT count(*) FROM bench');
                expect(tsRes[0]['COUNT(*)']).toBe(rowCount);
                expect(wasmRes[0]['COUNT(*)']).toBe(rowCount);
            }, 120000);

            it('LIMIT 10', async () => {
                const { tsRes, wasmRes } = await benchmark('LIMIT 10', 'SELECT * FROM bench LIMIT 10');
                expect(tsRes.length).toBe(10);
                expect(wasmRes.length).toBe(10);
            }, 120000);

            it('WHERE + LIMIT: val > 500 LIMIT 10', async () => {
                const { tsRes, wasmRes } = await benchmark(
                    'WHERE+LIMIT',
                    'SELECT * FROM bench WHERE val > 500 LIMIT 10'
                );
                expect(tsRes.length).toBe(Math.min(10, tsRes.length));
                expect(wasmRes.length).toBe(Math.min(10, wasmRes.length));
            }, 120000);
        });
    }
});
