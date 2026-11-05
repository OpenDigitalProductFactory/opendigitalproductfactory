import { randomUUID } from "node:crypto";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/client/client";
import {
  createSanitizedCloneWriter,
  observeSanitizedTableCopy,
  createSanitizedCloneSanitizer,
  copyRowsForSanitization,
} from "./sanitized-clone";

const databaseUrl = process.env.DATABASE_URL;
const enabled = databaseUrl && process.env.DPF_CLONE_SCALE_QUALIFICATION === "14523204";
const describeScale = enabled ? describe : describe.skip;
const schema = `sanitized_clone_scale_${randomUUID().replaceAll("-", "")}`;
let client: Client;
let destinationClient: PrismaClient;
const fixtureName = (purpose: string) => `clone_${purpose}_${randomUUID().replaceAll("-", "")}`;
const publicFixture = (name: string) => `public."${name}"`;

// Match the behavioral suite's retained-live-heap measurement methodology.
setFlagsFromString("--expose-gc");
const collectGarbage = runInNewContext("gc") as () => void;
const retainedHeap = () => { collectGarbage(); return process.memoryUsage().heapUsed; };
const sourceClient = {
  async $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T> {
    const result = await client.query(query, values as never[]);
    return result.rows as T;
  },
};

describeScale("sanitized clone opt-in PostgreSQL scale qualification", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    destinationClient = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl!, max: 1, options: "-c search_path=public" }),
    });
    await destinationClient.$connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
  });

  afterAll(async () => {
    if (!client) return;
    try {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await destinationClient?.$disconnect();
      await client.end();
    }
  });

  // Explicit opt-in only; this value is a cohort selector, not resource admission.
  // Run only inside the normally admitted qualification environment.
  it.skipIf(process.env.DPF_CLONE_SCALE_QUALIFICATION !== "14523204")(
    "qualifies an explicitly synthetic 14523204-row telemetry cohort through the actual clone caller",
    async () => {
      const count = 14_523_204;
      const budgetMs = 20 * 60 * 1000;
      const started = performance.now();
      const name = fixtureName("telemetry_scale");
      const source = `"${schema}"."${name}"`;
      const destination = publicFixture(name);
      const users = `"${schema}"."User"`;
      const columns = ["id", "queueKey", "itemKind", "itemId", "transition", "outcome",
        "laneKey", "actorType", "actorId", "occurredAt", "createdAt"];
      const projection = (alias: string) => columns.map(column => `${alias}."${column}"`).join(",");
      let copyStarted = 0;
      let copyElapsedMs = 0;
      let progressEvents = 0;
      let lastProcessed = 0;
      let lastElapsed = 0;
      let terminalCompleted = false;
      let sampledRows = 0;
      let retainedPeakGrowth = 0;
      let rssPeak = process.memoryUsage().rss;
      let memorySamples = 0;
      let baseline = 0;
      let setupMs = 0;
      let sourceRows: number | null = null;
      let persistedRows: number | null = null;
      let mismatchedRows: number | null = null;
      let passed = false;
      let cleanupComplete = false;
      const assertBudget = () => {
        if (performance.now() - started >= budgetMs) throw new Error("Synthetic scale qualification exceeded its 20-minute budget");
      };
      const sampleMemory = () => {
        retainedPeakGrowth = Math.max(retainedPeakGrowth, retainedHeap() - baseline);
        rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
        memorySamples++;
        expect(retainedPeakGrowth).toBeLessThan(16 * 1024 ** 2);
      };
      try {
        // LIKE retains the real eleven-column telemetry shape and all indexes.
        // Only unique owned fixture tables are written; the installed table is read as DDL.
        await client.query(`CREATE TABLE ${source} (LIKE public."QueueTelemetryEvent" INCLUDING ALL)`);
        await client.query(`CREATE TABLE ${destination} (LIKE public."QueueTelemetryEvent" INCLUDING ALL)`);
        await client.query(`CREATE TABLE ${users} (id text PRIMARY KEY)`);
        await client.query(`INSERT INTO ${source} (${columns.map(column => `"${column}"`).join(",")})
          SELECT lpad(i::text,25,'0'), 'synthetic:qualification', 'work-item',
            'synthetic-' || i::text, 'finished', CASE WHEN i % 7 = 0 THEN NULL ELSE 'success' END,
            CASE WHEN i % 3 = 0 THEN NULL ELSE 'synthetic-lane' END,
            'system', NULL, timestamp '2026-01-01' + (i % 86400) * interval '1 second',
            timestamp '2026-01-01' + (i % 86400) * interval '1 second'
          FROM generate_series(1,${count}) i`);
        await client.query(`ANALYZE ${source}`);
        await client.query(`SET search_path TO "${schema}", public`);
        setupMs = performance.now() - started;
        assertBudget();
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        expect((await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only).toBe("on");
        sourceRows = Number((await client.query(`SELECT count(*)::text AS n FROM ${source}`)).rows[0].n);
        expect(sourceRows).toBe(count);
        const writer = createSanitizedCloneWriter(destinationClient);
        baseline = retainedHeap();
        copyStarted = performance.now();
        await observeSanitizedTableCopy(name, async (metrics, onWindow) => {
          await copyRowsForSanitization(client, sourceClient, destinationClient, name,
            next => writer.copyBatches(name, next, createSanitizedCloneSanitizer(0), metrics, rows => {
              assertBudget();
              onWindow(rows);
              // Scalar-only probe after awaited insertion/window release.
              if (metrics.rows - sampledRows >= 10_000) {
                sampledRows = metrics.rows;
                sampleMemory();
              }
            }), undefined, metrics);
          expect(metrics.rows).toBe(count);
          expect(metrics.batches).toBe(Math.ceil(count / 50));
          expect(metrics.transactionAttempts).toBeGreaterThanOrEqual(Math.ceil(count / 500));
        }, count, { log: line => {
          const event = JSON.parse(line.slice(line.indexOf("{")));
          if (line.startsWith("[sanitized-clone-progress]")) {
            expect(event.processedRows).toBeGreaterThan(lastProcessed);
            expect(event.elapsedMs - lastElapsed).toBeGreaterThanOrEqual(1000);
            expect(event.estimatedRemainingRows).toBe(count - event.processedRows);
            expect(event).not.toHaveProperty("committedRows");
            lastProcessed = event.processedRows;
            lastElapsed = event.elapsedMs;
            progressEvents++;
          } else if (line.startsWith("[sanitized-clone-phase]")) {
            terminalCompleted = event.completed;
          }
          console.info(line);
        } });
        copyElapsedMs = performance.now() - copyStarted;
        sampleMemory();
        expect(progressEvents).toBeGreaterThan(0);
        expect(terminalCompleted).toBe(true);
        assertBudget();
        // End the source snapshot before observing destination commits.
        await client.query("COMMIT");
        // Compare scalar aggregate results; never materialize the cohort in Node.
        const totals = await client.query(`SELECT count(*)::text AS n FROM ${destination}`);
        persistedRows = Number(totals.rows[0].n);
        const mismatch = await client.query(`SELECT count(*)::text AS n FROM ${source} s
          LEFT JOIN ${destination} d ON d.id=s.id
          WHERE ROW(${projection("s")}) IS DISTINCT FROM ROW(${projection("d")})`);
        mismatchedRows = Number(mismatch.rows[0].n);
        expect(persistedRows).toBe(count);
        expect(mismatchedRows).toBe(0);
        expect(Number((await client.query(`SELECT count(*)::text AS n FROM ${source}`)).rows[0].n)).toBe(count);

        assertBudget();
        passed = true;
      } finally {
        // Ordinary failure cleanup. Forced runner termination additionally requires
        // the owning environment's existing cleanup/fencing evidence.
        try {
          await client.query("ROLLBACK");
          await client.query("SET search_path TO public");
          await client.query(`DROP TABLE IF EXISTS ${destination}`);
          await client.query(`DROP TABLE IF EXISTS ${source}`);
          await client.query(`DROP TABLE IF EXISTS ${users}`);
          cleanupComplete = true;
        } finally {
          console.info("[sanitized-clone-scale] " + JSON.stringify({
            cohort: "synthetic-telemetry-14523204", originalCohortProvenance: "unknown",
            fullPreviewStartup: false, passed, cleanupComplete, sourceRows, persistedRows, mismatchedRows,
            setupMs, copyElapsedMs, totalElapsedMs: performance.now() - started,
            progressEvents, terminalCompleted, memorySamples, retainedPeakGrowth, rssPeak,
            retainedHeapSampling: "after each 10000 processed rows and copy completion",
            startupBudgetMs: budgetMs,
          }));
        }
      }
    }, 20 * 60 * 1000,
  );
});
