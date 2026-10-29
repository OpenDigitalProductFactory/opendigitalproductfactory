import { randomUUID } from "node:crypto";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "../generated/client/client";
import {
  createSanitizedCloneInsertWriter,
  createSanitizedCloneWriter,
  createSanitizedCloneSanitizer,
  copyRowsForSanitization,
  buildSanitizedCursorQuery,
  insertRowsWithReplicationDisabled,
  runSourceCheckedClone,
  sanitizeConfidentialRow,
} from "./sanitized-clone";
import { assertSanitizedCloneSourceIntegrity } from "./sanitized-clone-source-integrity";
import { copySanitizedCursorBatches, withSanitizedCursorBatches } from "./sanitized-clone-batches";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const schema = `sanitized_clone_integrity_${randomUUID().replaceAll("-", "")}`;
let client: Client;
let destinationClient: PrismaClient;
let connectedHeap = 0;

// The writer discovers public-schema metadata. Every destination fixture owns
// a unique public name, rather than touching any installed application table.
const fixtureName = (purpose: string) => `clone_${purpose}_${randomUUID().replaceAll("-", "")}`;
const publicFixture = (name: string) => `public."${name}"`;

// heapUsed counts unreachable garbage until V8 chooses to collect it, so an
// unforced sample measures GC timing rather than what the copier retains.
// Collect first so the bound applies to live (retained) heap only.
setFlagsFromString("--expose-gc");
const collectGarbage = runInNewContext("gc") as () => void;
const retainedHeap = () => { collectGarbage(); return process.memoryUsage().heapUsed; };

async function destinationCount(): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "${schema}"."Destination"`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

const sourceClient = {
  async $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T> {
    const result = await client.query(query, values as never[]);
    return result.rows as T;
  },
};

describeDatabase("sanitized clone publication with PostgreSQL", () => {
  it("compares50and500row transactions through the real confidential caller with identical values and duplicate winners", async () => {
    const name = fixtureName("stream_cost");
    const table = `"${schema}"."${name}"`;
    const destination = publicFixture(name);
    const users = `"${schema}"."User"`;
    const results: Array<Record<string, unknown>> = [];
    let expectedDigest: string | null = null;
    try {
      await client.query(`CREATE TABLE ${users} (id text PRIMARY KEY)`);
      await client.query(`INSERT INTO ${users} VALUES ('000001'), ('000003')`);
      await client.query(`CREATE TABLE ${table} (id text PRIMARY KEY, name text, payload jsonb, embedding vector(3))`);
      await client.query(`CREATE TABLE ${destination} (id text PRIMARY KEY, name text, payload jsonb, embedding vector(3))`);
      await client.query(`CREATE UNIQUE INDEX ON ${destination} ((payload->>'dedupe'))`);
      await client.query(`INSERT INTO ${table} SELECT lpad(i::text, 6, '0'), 'Source person', jsonb_build_object('dedupe', i % 30000, 'value', i, 'text', repeat('x',128)), '[0.1,0.2,0.3]'::vector FROM generate_series(1,50001) i`);
      // The source and destination fixtures have identical column metadata.
      // Only source data resolves through this private schema; destination
      // catalog/writer connections remain public, as in the real caller.
      await client.query(`SET search_path TO "${schema}", public`);
      for (const ceiling of [50, 500, 500, 50]) {
        await client.query(`TRUNCATE TABLE ${destination}`);
        const metrics = { fetchMs: 0, fetches: 0, rows: 0, batches: 0, sanitizeMs: 0, insertMs: 0, transactionAttempts: 0, transactionMs: 0, transactionWorkMs: 0 };
        const writer = createSanitizedCloneWriter(destinationClient, { batchSize: ceiling, maxWaitMs: 10000, timeoutMs: 30000 });
        const started = performance.now();
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        await copyRowsForSanitization(client, sourceClient, destinationClient, name,
          next => writer.copyBatches(name, next, createSanitizedCloneSanitizer(2), metrics), undefined, metrics);
        await client.query("COMMIT");
        const elapsedMs = performance.now() - started;
        const rows = await client.query(`SELECT count(*)::int AS count, md5(string_agg(row_to_json(d)::text, ',' ORDER BY id)) AS digest FROM ${destination} d`);
        expect(rows.rows[0].count).toBe(30000);
        if (expectedDigest === null) expectedDigest = rows.rows[0].digest;
        expect(rows.rows[0].digest).toBe(expectedDigest);
        expect(metrics.rows).toBe(50001); expect(metrics.batches).toBe(1001); expect(metrics.fetches).toBe(1002);
        if (ceiling === 50) expect(metrics.transactionAttempts).toBe(1001);
        else expect(metrics.transactionAttempts).toBeGreaterThanOrEqual(101);
        expect((await client.query(`SELECT name, embedding FROM ${destination} WHERE id = '000001'`)).rows[0]).toEqual({ name: "Dev User 001", embedding: null });
        results.push({ ceiling, elapsedMs, ...metrics });
      }
      expect((await client.query(`SELECT count(*)::int AS count FROM ${table} WHERE name = 'Source person' AND embedding IS NOT NULL`)).rows[0].count).toBe(50001);
      console.info(`[sanitized-clone-comparison] ${JSON.stringify({ sourceRows: 50001, copiedRows: 30000, results })}`);
    } finally {
      await client.query("ROLLBACK");
      await client.query("SET search_path TO public");
      await client.query(`DROP TABLE IF EXISTS ${table}`);
      await client.query(`DROP TABLE IF EXISTS ${destination}`);
      await client.query(`DROP TABLE IF EXISTS ${users}`);
    }
  }, 30_000);

  it.each(["source", "write", "commit"])("cleans previously committed groups after a real streamed %s failure", async failure => {
    const name = fixtureName("stream_failure");
    const source = `"${schema}"."${name}"`, destination = publicFixture(name);
    const trigger = fixtureName("deferred_fail");
    const fn = `"${schema}"."${trigger}"`;
    let fetches = 0;
    try {
      await client.query(`CREATE TABLE ${source} (id int PRIMARY KEY, name text)`);
      await client.query(`CREATE TABLE ${destination} (id int PRIMARY KEY, name text ${failure === "write" ? ", CHECK (id < 751)" : ""})`);
      if (failure === "commit") {
        await client.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id >= 751 THEN RAISE EXCEPTION 'fixture deferred commit failure'; END IF; RETURN NEW; END $$`);
        await client.query(`CREATE CONSTRAINT TRIGGER "${trigger}" AFTER INSERT ON ${destination} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
        await client.query(`ALTER TABLE ${destination} ENABLE ALWAYS TRIGGER "${trigger}"`);
      }
      await client.query(`INSERT INTO ${source} SELECT i, 'Source person' FROM generate_series(1,1001) i`);
      const sourceReader = { async query(sql: string) {
        if (sql.startsWith("FETCH") && ++fetches === 12 && failure === "source") throw new Error("fixture source failure");
        return client.query(sql);
      } };
      const metrics = { fetchMs: 0, fetches: 0, rows: 0, batches: 0, sanitizeMs: 0, transactionAttempts: 0, transactionMs: 0 };
      const writer = createSanitizedCloneWriter(destinationClient);
      await expect(runSourceCheckedClone(
        async () => { await destinationClient.$executeRawUnsafe(`TRUNCATE TABLE ${destination}`); },
        async () => {},
        () => withSanitizedCursorBatches(sourceReader, `SELECT id, name FROM ${source} ORDER BY id`,
          next => writer.copyBatches(name, next, createSanitizedCloneSanitizer(0), metrics), 50, true, metrics),
      )).rejects.toThrow();
      expect(metrics.transactionAttempts).toBe(2);
      expect((await client.query(`SELECT count(*)::int AS count FROM ${destination}`)).rows[0].count).toBe(0);
      expect((await client.query(`SELECT count(*)::int AS count FROM ${source} WHERE name='Source person'`)).rows[0].count).toBe(1001);
    } finally {
      await client.query("ROLLBACK");
      await client.query(`DROP TABLE IF EXISTS ${source}`);
      await client.query(`DROP TABLE IF EXISTS ${destination}`);
      if (failure === "commit") await client.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
  }, 30_000);

  it("measures real narrow-row fetch, sanitization and destination phases without changing the cohort", async () => {
    const table = `"${schema}"."TelemetryCost"`;
    const destinationName = fixtureName("telemetry_cost");
    const destination = publicFixture(destinationName);
    const metrics = { fetchMs: 0, fetches: 0, rows: 0, batches: 0, sanitizeMs: 0, writeMs: 0, transactionAttempts: 0, transactionMs: 0, transactionWorkMs: 0 };
    const write = createSanitizedCloneInsertWriter(destinationClient);
    const count = 50_001;
    try {
      await client.query(`CREATE TABLE ${table} (id bigint PRIMARY KEY, name text, payload jsonb)`);
      await client.query(`CREATE TABLE ${destination} (id bigint PRIMARY KEY, name text, payload jsonb)`);
      await client.query(`INSERT INTO ${table} SELECT i, 'Source person', jsonb_build_object('value', i, 'text', repeat('x', 128)) FROM generate_series(1, ${count}) i`);
      const started = performance.now();
      await copySanitizedCursorBatches(client, `SELECT id, name, payload FROM ${table} ORDER BY id`, async rows => {
        const transformStarted = performance.now();
        for (let i = 0; i < rows.length; i++) rows[i] = sanitizeConfidentialRow(rows[i]!, Number(rows[i]!.id));
        metrics.sanitizeMs += performance.now() - transformStarted;
        const writeStarted = performance.now();
        try { await write(destinationName, rows, metrics); }
        finally { metrics.writeMs += performance.now() - writeStarted; }
      }, 50, true, metrics);
      const elapsedMs = performance.now() - started;
      expect(metrics.rows).toBe(count);
      expect(metrics.batches).toBe(1001);
      expect(metrics.fetches).toBe(1002);
      expect(metrics.transactionAttempts).toBe(1001);
      expect(metrics.transactionWorkMs).toBeGreaterThan(0);
      expect(metrics.transactionWorkMs).toBeLessThanOrEqual(metrics.transactionMs);
      const persisted = await client.query(`SELECT count(*)::int AS count FROM ${destination} WHERE name LIKE 'Dev User %' AND payload->>'value' = id::text`);
      expect(persisted.rows[0].count).toBe(count);
      const untouched = await client.query(`SELECT count(*)::int AS count FROM ${table} WHERE name = 'Source person'`);
      expect(untouched.rows[0].count).toBe(count);
      console.info(`[sanitized-clone-cost] ${JSON.stringify({ cohort: "narrow-telemetry-fixture", elapsedMs, ...metrics })}`);
    } finally {
      await client.query(`DROP TABLE IF EXISTS ${table}`);
      await client.query(`DROP TABLE IF EXISTS ${destination}`);
    }
  }, 30_000);
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    destinationClient = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl!, max: 1, options: "-c search_path=public" }),
    });
    await destinationClient.$connect();
    connectedHeap = retainedHeap();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`
      CREATE TABLE "${schema}"."Destination" (
        id TEXT PRIMARY KEY,
        "entityKey" TEXT NOT NULL UNIQUE
      );
      CREATE TABLE "${schema}"."InventoryEntity" (
        id TEXT PRIMARY KEY,
        "entityKey" TEXT NOT NULL
      );
      CREATE UNIQUE INDEX "InventoryEntity_entityKey_key"
        ON "${schema}"."InventoryEntity" ("entityKey");
      CREATE TABLE "${schema}"."PlatformIssueReport" (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        "dedupeKey" TEXT
      );
      CREATE INDEX "PlatformIssueReport_dedupeKey_idx"
        ON "${schema}"."PlatformIssueReport" ("dedupeKey");
      CREATE UNIQUE INDEX "PlatformIssueReport_dedupeKey_open_key"
        ON "${schema}"."PlatformIssueReport" ("dedupeKey")
        WHERE "dedupeKey" IS NOT NULL
          AND status NOT IN ('resolved_locally', 'resolved_upstream', 'suppressed')
    `);
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

  it("keeps legacy ordered values, audit cohort and aliases without a global ordinal sort", async () => {
    const tableName = fixtureName("ordered");
    const table = publicFixture(tableName);
    const users = `"${schema}"."CloneUser"`;
    try {
      await client.query(`CREATE TABLE ${table} (id text PRIMARY KEY, name text, "createdAt" timestamptz, payload jsonb)`);
      await client.query(`CREATE TABLE ${users} (id text PRIMARY KEY)`);
      await client.query(`INSERT INTO ${users} VALUES ('000001'), ('000003')`);
      await client.query(`INSERT INTO ${table}
        SELECT lpad(i::text, 6, '0'), 'Source person',
          CASE WHEN i % 7 = 0 THEN NULL ELSE '2026-01-01'::timestamptz + (i % 3) * interval '1 day' END,
          jsonb_build_object('value', i) FROM generate_series(1, 10001) i`);
      await client.query(`ANALYZE ${table}`);
      for (const limit of [undefined, 50]) {
        const sql = buildSanitizedCursorQuery(tableName, '"id", "name", "createdAt", "payload"',
          new Set(["id", "name", "createdAt", "payload"]), limit).replace('FROM "User"', `FROM ${users}`);
        const legacy = sql.replace(/ORDER BY r\.[\s\S]*$/, 'ORDER BY r."__dpfCloneRowOrder"');
        const expected = (await client.query(legacy)).rows;
        const actual = (await client.query(sql)).rows;
        expect(actual).toEqual(expected);
        expect(actual).toHaveLength(limit ?? 10001);
        let index = 2;
        const aliases = actual.map(row => sanitizeConfidentialRow(row,
          row.__dpfCloneUserIndex == null ? ++index : Number(row.__dpfCloneUserIndex)));
        expect(aliases[0]?.name).toBe(limit ? "Dev User 003" : "Dev User 001");
        if (!limit) {
          const result = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`);
          const plan = result.rows[0]["QUERY PLAN"][0].Plan;
          expect(plan["Node Type"]).not.toBe("Sort");
          let copied = 0;
          let largestBatch = 0;
          await copySanitizedCursorBatches(client, sql, async rows => {
            largestBatch = Math.max(largestBatch, rows.length);
            expect(rows).toEqual(actual.slice(copied, copied + rows.length));
            copied += rows.length;
          }, 50);
          expect(copied).toBe(10001);
          expect(largestBatch).toBe(50);
        }
      }
    } finally {
      await client.query(`DROP TABLE IF EXISTS ${table}`);
      await client.query(`DROP TABLE IF EXISTS ${users}`);
    }
  }, 30_000);

  it("reads large JSON and native vector data in bounded batches without fetching vector content", async () => {
    const table = `"${schema}"."PayloadBatch"`;
    const destinationName = fixtureName("payload");
    const destination = publicFixture(destinationName);
    const write = createSanitizedCloneInsertWriter(destinationClient);
    try {
      await client.query(`CREATE TABLE ${table} (id bigint PRIMARY KEY, name text, payload jsonb, embedding vector(3072))`);
      await client.query(`CREATE TABLE ${destination} (id bigint PRIMARY KEY, name text, payload jsonb, embedding vector(3072))`);
      await client.query(`INSERT INTO ${table}
        SELECT i, 'Source person', jsonb_build_object('text', repeat('x', 32768), 'array', jsonb_build_array(i, i + 1)),
          array_fill(0.5::real, ARRAY[3072])::vector
        FROM generate_series(1, 2001) i`);
      let total = 0;
      let largestBatch = 0;
      const heapBefore = retainedHeap();
      let peakHeapGrowth = 0;
      const coldSamples: Array<{ rows: number; heapUsed: number; growth: number }> = [];
      await copySanitizedCursorBatches(client,
        `SELECT id, name, payload, NULL::text AS embedding FROM ${table} ORDER BY id`,
        async rows => {
          largestBatch = Math.max(largestBatch, rows.length);
          total += rows.length;
          expect(rows.every(row => row.embedding === null)).toBe(true);
          expect((rows[0]?.payload as { text: string }).text).toHaveLength(32768);
          for (let i = 0; i < rows.length; i++) rows[i] = sanitizeConfidentialRow(rows[i]!, Number(rows[i]!.id));
          await write(destinationName, rows);
          const heapUsed = retainedHeap();
          peakHeapGrowth = Math.max(peakHeapGrowth, heapUsed - heapBefore);
          coldSamples.push({ rows: total, heapUsed, growth: heapUsed - heapBefore });
        }, 50);
      expect(total).toBe(2001);
      expect(largestBatch).toBe(50);
      const copied = await client.query(`SELECT count(*)::int AS count FROM ${destination} WHERE name LIKE 'Dev User %' AND embedding IS NULL`);
      expect(copied.rows[0].count).toBe(2001);
      const coldAfterCopy = retainedHeap();
      // Diagnostic controls use the same real writer, payload and source cursor.
      // Preserve the original cold baseline and 16 MiB assertion below.
      const controlPhase = async (phase: string, rowLimit: number, retain: boolean) => {
        await client.query(`TRUNCATE TABLE ${destination}`);
        const phaseWrite = createSanitizedCloneInsertWriter(destinationClient);
        const baseline = retainedHeap();
        const samples: Array<{ rows: number; heapUsed: number; growth: number }> = [];
        const retainedBatches: Array<Array<Record<string, unknown>>> = [];
        let rowsCopied = 0;
        await copySanitizedCursorBatches(client,
          `SELECT id, name, payload, NULL::text AS embedding FROM ${table} ORDER BY id LIMIT ${rowLimit}`,
          async rows => {
            rowsCopied += rows.length;
            for (let i = 0; i < rows.length; i++) rows[i] = sanitizeConfidentialRow(rows[i]!, Number(rows[i]!.id));
            // The copier empties its rows array; retain an independent container
            // so this positive control actually keeps the payload objects alive.
            if (retain) retainedBatches.push(rows.slice());
            await phaseWrite(destinationName, rows);
            const heapUsed = retainedHeap();
            samples.push({ rows: rowsCopied, heapUsed, growth: heapUsed - baseline });
          }, 50);
        const afterCopy = retainedHeap();
        // Read payload content after sampling so the control remains live.
        const retainedPayloadBytes = retainedBatches.reduce((sum, batch) => sum + batch.reduce(
          (bytes, row) => bytes + (row.payload as { text: string }).text.length, 0), 0);
        retainedBatches.length = 0;
        const afterRelease = retainedHeap();
        return { phase, baseline, rowsCopied, samples,
          peakGrowth: Math.max(...samples.map(sample => sample.growth)),
          afterCopyGrowth: afterCopy - baseline, retainedPayloadBytes,
          afterReleaseGrowth: afterRelease - baseline };
      };
      const warm = await controlPhase("warm-same-path", 2001, false);
      const retained = await controlPhase("intentional-retained-batches", 1001, true);
      console.info(`[sanitized-clone-memory] ${JSON.stringify({ connectedHeap,
        cold: { baseline: heapBefore, samples: coldSamples, peakGrowth: peakHeapGrowth,
          afterCopyGrowth: coldAfterCopy - heapBefore }, warm, retained })}`);
      expect(warm.rowsCopied).toBe(2001);
      expect(warm.peakGrowth).toBeLessThan(16 * 1024 * 1024);
      expect(retained.rowsCopied).toBe(1001);
      expect(retained.retainedPayloadBytes).toBe(1001 * 32768);
      expect(retained.afterCopyGrowth).toBeGreaterThan(16 * 1024 * 1024);
      // More than 64 MiB JSON plus 3072-element vectors is processed without a
      // table-sized JS retention: live heap after each batch stays far below the
      // ~63 MiB the full table would retain (one 50-row batch is ~1.6 MiB), so
      // the bound catches cross-batch retention. Native vectors never cross the
      // source wire.
      expect(peakHeapGrowth).toBeLessThan(16 * 1024 * 1024);
    } finally {
      await client.query(`DROP TABLE IF EXISTS ${table}`);
      await client.query(`DROP TABLE IF EXISTS ${destination}`);
    }
  }, 20_000); // Three measured passes, not a production timeout or memory-limit change.

  it("persists incumbent value conversions, omitted defaults and first-conflict winners through PrismaPg", async () => {
    const tableName = fixtureName("values");
    const table = publicFixture(tableName);
    const enumName = fixtureName("enum");
    const enumType = publicFixture(enumName);
    const escapedEnum = 'needs,"review\\path';
    const occurredAt = new Date("2026-10-21T12:34:56.789Z");
    try {
      await client.query(`CREATE TYPE ${enumType} AS ENUM ('ready', $enum$${escapedEnum}$enum$)`);
      await client.query(`CREATE TABLE ${table} (
        id text PRIMARY KEY,
        json_object jsonb,
        json_array jsonb,
        json_plain json,
        texts text[],
        numbers numeric[],
        states ${enumType}[],
        amount numeric(30, 10),
        occurred_at timestamptz,
        bytes bytea,
        nullable text DEFAULT 'nullable-default',
        defaulted text NOT NULL DEFAULT 'default-value',
        label text DEFAULT 'label-default'
      )`);
      const full = {
        id: "full-a",
        json_object: { quoted: 'a"b\\c', nested: [true, null, 7], unicode: "café" },
        json_array: ["a,b", { path: "x\\y" }, null],
        json_plain: "JSON scalar with a quote: \"",
        texts: ["a,b", 'quote"value', "slash\\value", "{brace}", "", "NULL"],
        numbers: [1, -2.5, 3.125],
        states: ["ready", escapedEnum],
        amount: { toString: () => "1234567890.125" },
        occurred_at: occurredAt,
        bytes: Buffer.from([0, 255, 92, 34]),
        nullable: "present",
        defaulted: "explicit",
        label: "first-full",
      };
      // A reversed property order and noncontiguous column sets must retain
      // their own parameter-to-column mapping and original conflict order.
      const reversed = Object.fromEntries(Object.entries({
        ...full, id: "full-b", amount: 19.5, label: "second-full",
      }).reverse());
      await insertRowsWithReplicationDisabled(destinationClient, tableName, [
        full,
        { ...full, label: "same-statement-loser" },
        reversed,
        { id: "mixed", label: "first-minimal" },
        { id: "omitted", label: "omitted" },
        { ...full, id: "mixed", label: "later-full" },
        { id: "null", nullable: null, json_object: null },
        { id: "undefined", nullable: undefined, label: undefined },
        { id: "full-a", label: "later-partial" },
      ]);
      const actual = await client.query(`SELECT id, json_object, json_array, json_plain,
        texts, numbers::text[] AS numbers, states::text[] AS states,
        amount::text AS amount, occurred_at, encode(bytes, 'hex') AS bytes,
        nullable, defaulted, label FROM ${table}`);
      // Fixed persisted expectations are independent of the SQL preparation
      // helpers, so this guards conversions as well as statement construction.
      const expectedFull = {
        json_object: { quoted: 'a"b\\c', nested: [true, null, 7], unicode: "café" },
        json_array: ["a,b", { path: "x\\y" }, null],
        json_plain: "JSON scalar with a quote: \"",
        texts: ["a,b", 'quote"value', "slash\\value", "{brace}", "", "NULL"],
        numbers: ["1", "-2.5", "3.125"],
        states: ["ready", 'needs,"review\\path'],
        amount: "1234567890.1250000000",
        occurred_at: new Date("2026-10-21T12:34:56.789Z"),
        bytes: "00ff5c22",
        nullable: "present",
        defaulted: "explicit",
      };
      const expectedOmitted = {
        json_object: null, json_array: null, json_plain: null,
        texts: null, numbers: null, states: null, amount: null,
        occurred_at: null, bytes: null,
        nullable: "nullable-default", defaulted: "default-value",
      };
      expect(Object.fromEntries(actual.rows.map(row => [row.id, row]))).toEqual({
        "full-a": { ...expectedFull, id: "full-a", label: "first-full" },
        "full-b": { ...expectedFull, id: "full-b", amount: "19.5000000000", label: "second-full" },
        mixed: { ...expectedOmitted, id: "mixed", label: "first-minimal" },
        omitted: { ...expectedOmitted, id: "omitted", label: "omitted" },
        null: { ...expectedOmitted, id: "null", nullable: null, label: "label-default" },
        undefined: { ...expectedOmitted, id: "undefined", nullable: null, label: null },
      });
    } finally {
      await client.query(`DROP TABLE IF EXISTS ${table}`);
      await client.query(`DROP TYPE IF EXISTS ${enumType}`);
    }
  });

  it("executes bounded multirow statements with replica triggers on the pinned PrismaPg connection", async () => {
    const tableName = fixtureName("batch");
    const table = publicFixture(tableName);
    const audit = publicFixture(fixtureName("audit"));
    const triggerFunction = publicFixture(fixtureName("trigger"));
    try {
      await client.query(`CREATE TABLE ${table} (id integer PRIMARY KEY, value text NOT NULL)`);
      await client.query(`CREATE TABLE ${audit} (
        id bigserial PRIMARY KEY, row_count integer NOT NULL,
        transaction_id text NOT NULL, backend_pid integer NOT NULL,
        replication_role text NOT NULL
      )`);
      await client.query(`CREATE FUNCTION ${triggerFunction}() RETURNS trigger LANGUAGE plpgsql AS $fixture$
        BEGIN
          IF TG_LEVEL = 'ROW' THEN
            RAISE EXCEPTION 'origin fixture trigger fired';
          END IF;
          INSERT INTO ${audit} (row_count, transaction_id, backend_pid, replication_role)
            SELECT count(*)::integer, txid_current()::text, pg_backend_pid(),
              current_setting('session_replication_role') FROM new_rows;
          RETURN NULL;
        END
      $fixture$`);
      await client.query(`CREATE TRIGGER clone_origin_guard BEFORE INSERT ON ${table}
        FOR EACH ROW EXECUTE FUNCTION ${triggerFunction}()`);
      await client.query(`CREATE TRIGGER clone_statement_audit AFTER INSERT ON ${table}
        REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION ${triggerFunction}()`);
      await client.query(`ALTER TABLE ${table} ENABLE ALWAYS TRIGGER clone_statement_audit`);
      const write = createSanitizedCloneInsertWriter(destinationClient, {
        batchSize: 60, maxWaitMs: 10_000, timeoutMs: 30_000,
      });
      await write(tableName, [
        ...Array.from({ length: 122 }, (_, id) => ({ id, value: `value-${id}` })),
        { id: 0, value: "later-transaction-loser" },
      ]);
      const copied = await client.query(`SELECT id, value FROM ${table} ORDER BY id`);
      expect(copied.rows).toEqual(Array.from({ length: 122 }, (_, id) => ({ id, value: `value-${id}` })));
      const statements = await client.query<{
        row_count: number; transaction_id: string; backend_pid: number; replication_role: string;
      }>(`SELECT row_count, transaction_id, backend_pid, replication_role FROM ${audit} ORDER BY id`);
      expect(statements.rows.map(row => row.row_count)).toEqual([50, 10, 50, 10, 2]);
      const transactionIds = statements.rows.map(row => row.transaction_id);
      expect(transactionIds[0]).toBe(transactionIds[1]);
      expect(transactionIds[2]).toBe(transactionIds[3]);
      expect(new Set(transactionIds).size).toBe(3);
      expect(statements.rows.every(row => row.replication_role === "replica")).toBe(true);
      const [restored] = await destinationClient.$queryRawUnsafe<Array<{ role: string; pid: number }>>(
        "SELECT current_setting('session_replication_role') AS role, pg_backend_pid() AS pid",
      );
      expect(restored?.role).toBe("origin");
      // A single-connection PrismaPg pool makes the post-transaction check use
      // the exact backend on which the real statement trigger observed replica.
      expect(statements.rows.every(row => row.backend_pid === restored?.pid)).toBe(true);
      await expect(destinationClient.$executeRawUnsafe(
        `INSERT INTO ${table} (id, value) VALUES (999, 'origin')`,
      )).rejects.toThrow(/origin fixture trigger fired/);
      const count = await client.query(`SELECT count(*)::integer AS count FROM ${table}`);
      expect(count.rows[0].count).toBe(122);
    } finally {
      await client.query(`DROP TABLE IF EXISTS ${table}`);
      await client.query(`DROP TABLE IF EXISTS ${audit}`);
      await client.query(`DROP FUNCTION IF EXISTS ${triggerFunction}()`);
    }
  });

  it("rolls back a failed later chunk and removes earlier commits through clone cleanup", async () => {
    const tableName = fixtureName("rollback");
    const table = publicFixture(tableName);
    try {
      await client.query(`CREATE TABLE ${table} (
        id integer PRIMARY KEY, amount integer NOT NULL CHECK (amount >= 0)
      )`);
      const write = createSanitizedCloneInsertWriter(destinationClient, {
        batchSize: 60, maxWaitMs: 10_000, timeoutMs: 30_000,
      });
      const rows = Array.from({ length: 121 }, (_, id) => ({ id, amount: id === 115 ? -1 : id }));
      const [beforeFailure] = await destinationClient.$queryRawUnsafe<Array<{ pid: number }>>(
        "SELECT pg_backend_pid() AS pid",
      );
      // The first 60-row transaction commits. In transaction two, its first
      // 50-row statement succeeds before a CHECK failure rolls all 60 back.
      await expect(write(tableName, rows)).rejects.toThrow(/check constraint/i);
      const partial = await client.query(`SELECT id FROM ${table} ORDER BY id`);
      expect(partial.rows).toEqual(Array.from({ length: 60 }, (_, id) => ({ id })));
      const [restored] = await destinationClient.$queryRawUnsafe<Array<{ role: string; pid: number }>>(
        "SELECT current_setting('session_replication_role') AS role, pg_backend_pid() AS pid",
      );
      expect(restored?.role).toBe("origin");
      expect(restored?.pid).toBe(beforeFailure?.pid);
      let resets = 0;
      await expect(runSourceCheckedClone(
        async () => {
          resets++;
          await client.query(`TRUNCATE TABLE ${table}`);
        },
        async () => undefined,
        async () => write(tableName, rows),
      )).rejects.toThrow(/check constraint/i);
      expect(resets).toBe(2);
      const cleaned = await client.query(`SELECT count(*)::integer AS count FROM ${table}`);
      expect(cleaned.rows[0].count).toBe(0);
    } finally {
      await client.query(`DROP TABLE IF EXISTS ${table}`);
    }
  });

  it("empties the destination after a real unique-constraint clone failure", async () => {
    await client.query(
      `INSERT INTO "${schema}"."Destination" (id, "entityKey")
       VALUES ('stale', 'stale')`,
    );

    await expect(runSourceCheckedClone(
      async () => {
        await client.query(`TRUNCATE TABLE "${schema}"."Destination"`);
      },
      async () => {
        await client.query("SELECT 1");
      },
      async () => {
        await client.query(
          `INSERT INTO "${schema}"."Destination" (id, "entityKey")
           VALUES ('a', 'duplicate'), ('b', 'duplicate')`,
        );
      },
    )).rejects.toMatchObject({ code: "23505" });

    expect(await destinationCount()).toBe(0);
  });

  it("empties the destination before a source-integrity failure blocks publication", async () => {
    await client.query(
      `INSERT INTO "${schema}"."Destination" (id, "entityKey")
       VALUES ('stale-source-check', 'stale-source-check')`,
    );
    let cloneStarted = false;

    await expect(runSourceCheckedClone(
      async () => {
        await client.query(`TRUNCATE TABLE "${schema}"."Destination"`);
      },
      async () => {
        throw new Error(
          "Production PlatformIssueReport source failed index/heap integrity",
        );
      },
      async () => {
        cloneStarted = true;
      },
    )).rejects.toThrow(/PlatformIssueReport source failed/);

    expect(cloneStarted).toBe(false);
    expect(await destinationCount()).toBe(0);
  });

  it("runs the real source guard against healthy PostgreSQL contracts", async () => {
    await expect(assertSanitizedCloneSourceIntegrity(
      sourceClient,
      { schema },
    )).resolves.toBeUndefined();
  });

  it("names a missing PlatformIssueReport source index", async () => {
    await client.query(`
      DROP INDEX "${schema}"."PlatformIssueReport_dedupeKey_open_key"
    `);
    try {
      await expect(assertSanitizedCloneSourceIntegrity(
        sourceClient,
        { schema },
      )).rejects.toThrow(
        /PlatformIssueReport_dedupeKey_open_key: required index is missing/,
      );
    } finally {
      await client.query(`
        CREATE UNIQUE INDEX "PlatformIssueReport_dedupeKey_open_key"
          ON "${schema}"."PlatformIssueReport" ("dedupeKey")
          WHERE "dedupeKey" IS NOT NULL
            AND status NOT IN (
              'resolved_locally',
              'resolved_upstream',
              'suppressed'
            )
      `);
    }
  });

  it("rejects real heap duplicates hidden by a too-narrow partial predicate", async () => {
    await client.query(`
      DROP INDEX "${schema}"."PlatformIssueReport_dedupeKey_open_key";
      CREATE UNIQUE INDEX "PlatformIssueReport_dedupeKey_open_key"
        ON "${schema}"."PlatformIssueReport" ("dedupeKey")
        WHERE "dedupeKey" IS NOT NULL AND status = 'open';
      INSERT INTO "${schema}"."PlatformIssueReport" (id, status, "dedupeKey")
      VALUES
        ('semantic-duplicate-a', 'triaged_local', 'semantic-duplicate'),
        ('semantic-duplicate-b', 'triaged_local', 'semantic-duplicate');
    `);
    try {
      await expect(assertSanitizedCloneSourceIntegrity(
        sourceClient,
        { schema },
      )).rejects.toThrow(/1 active dedupeKey group/);
    } finally {
      await client.query(`
        DELETE FROM "${schema}"."PlatformIssueReport"
        WHERE id IN ('semantic-duplicate-a', 'semantic-duplicate-b');
        DROP INDEX "${schema}"."PlatformIssueReport_dedupeKey_open_key";
        CREATE UNIQUE INDEX "PlatformIssueReport_dedupeKey_open_key"
          ON "${schema}"."PlatformIssueReport" ("dedupeKey")
          WHERE "dedupeKey" IS NOT NULL
            AND status NOT IN (
              'resolved_locally',
              'resolved_upstream',
              'suppressed'
            )
      `);
    }
  });

  it("publishes the destination when the source guard and clone both succeed", async () => {
    await runSourceCheckedClone(
      async () => {
        await client.query(`TRUNCATE TABLE "${schema}"."Destination"`);
      },
      async () => {
        await client.query("SELECT 1");
      },
      async () => {
        await client.query(
          `INSERT INTO "${schema}"."Destination" (id, "entityKey")
           VALUES ('healthy', 'healthy')`,
        );
      },
    );

    expect(await destinationCount()).toBe(1);
  });
  it("keeps streamed real-writer retained heap below the existing16MiB bound for wide JSON and omitted vectors", async () => {
    const source = `"${schema}"."StreamWide"`, name = fixtureName("stream_wide"), destination = publicFixture(name);
    const streamClient = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl!, max: 1, options: "-c search_path=public" }) });
    let peak = 0;
    try {
      await streamClient.$connect();
      await client.query(`CREATE TABLE ${source} (id bigint PRIMARY KEY, name text, payload jsonb, embedding vector(3072))`);
      await client.query(`CREATE TABLE ${destination} (id bigint PRIMARY KEY, name text, payload jsonb, embedding vector(3072))`);
      await client.query(`INSERT INTO ${source} SELECT i, 'Source person', jsonb_build_object('text',repeat('x',32768)), array_fill(0.5::real,ARRAY[3072])::vector FROM generate_series(1,2001) i`);
      const baseline = retainedHeap();
      const observedClient = { $transaction: async (write: (tx: unknown) => Promise<void>, options: unknown) => {
        await streamClient.$transaction(write as never, options as never);
        peak = Math.max(peak, retainedHeap() - baseline);
      } };
      const writer = createSanitizedCloneWriter(observedClient as never);
      const metrics = { fetchMs: 0, fetches: 0, rows: 0, batches: 0, sanitizeMs: 0, transactionAttempts: 0, transactionMs: 0 };
      await withSanitizedCursorBatches(client, `SELECT id,name,payload,NULL::text AS embedding FROM ${source} ORDER BY id`,
        next => writer.copyBatches(name, next, createSanitizedCloneSanitizer(0), metrics), 50, true, metrics);
      expect(metrics.rows).toBe(2001); expect(peak).toBeLessThan(16 * 1024 ** 2);
      expect((await client.query(`SELECT count(*)::int AS count FROM ${destination} WHERE name LIKE 'Dev User %' AND embedding IS NULL AND length(payload->>'text')=32768`)).rows[0].count).toBe(2001);
      console.info(`[sanitized-clone-stream-memory] ${JSON.stringify({ sourceRows: 2001, retainedPeakGrowth: peak, ...metrics })}`);
    } finally {
      await streamClient.$disconnect();
      await client.query("ROLLBACK");
      await client.query(`DROP TABLE IF EXISTS ${source}`);
      await client.query(`DROP TABLE IF EXISTS ${destination}`);
    }
  }, 20_000);


});
