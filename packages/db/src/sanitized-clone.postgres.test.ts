import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runSourceCheckedClone, sanitizeConfidentialRow } from "./sanitized-clone";
import { assertSanitizedCloneSourceIntegrity } from "./sanitized-clone-source-integrity";
import { copySanitizedCursorBatches } from "./sanitized-clone-batches";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const schema = `sanitized_clone_integrity_${randomUUID().replaceAll("-", "")}`;
let client: Client;

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
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
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
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  it("reads large JSON and native vector data in bounded batches without fetching vector content", async () => {
    const table = `"${schema}"."PayloadBatch"`;
    const destination = `"${schema}"."PayloadBatchDestination"`;
    const writer = new Client({ connectionString: databaseUrl });
    await writer.connect();
    await client.query(`CREATE TABLE ${table} (id bigint PRIMARY KEY, name text, payload jsonb, embedding vector(3072))`);
    await writer.query(`CREATE TABLE ${destination} (id bigint PRIMARY KEY, name text, payload jsonb, embedding vector(3072))`);
    try {
      await client.query(`INSERT INTO ${table}
        SELECT i, 'Source person', jsonb_build_object('text', repeat('x', 32768), 'array', jsonb_build_array(i, i + 1)),
          array_fill(0.5::real, ARRAY[3072])::vector
        FROM generate_series(1, 2001) i`);
      let total = 0;
      let largestBatch = 0;
      const heapBefore = process.memoryUsage().heapUsed;
      let peakHeapGrowth = 0;
      await copySanitizedCursorBatches(client,
        `SELECT id, name, payload, NULL::text AS embedding FROM ${table} ORDER BY id`,
        async rows => {
          largestBatch = Math.max(largestBatch, rows.length);
          total += rows.length;
          expect(rows.every(row => row.embedding === null)).toBe(true);
          expect((rows[0]?.payload as { text: string }).text).toHaveLength(32768);
          for (let i = 0; i < rows.length; i++) rows[i] = sanitizeConfidentialRow(rows[i]!, Number(rows[i]!.id));
          await writer.query("BEGIN");
          try {
            for (const row of rows) await writer.query(`INSERT INTO ${destination} VALUES ($1, $2, $3::jsonb, $4)`,
              [row.id, row.name, JSON.stringify(row.payload), row.embedding]);
            await writer.query("COMMIT");
          } catch (error) { await writer.query("ROLLBACK"); throw error; }
          peakHeapGrowth = Math.max(peakHeapGrowth, process.memoryUsage().heapUsed - heapBefore);
        }, 50);
      expect(total).toBe(2001);
      expect(largestBatch).toBe(50);
      const copied = await writer.query(`SELECT count(*)::int AS count FROM ${destination} WHERE name LIKE 'Dev User %' AND embedding IS NULL`);
      expect(copied.rows[0].count).toBe(2001);
      // More than 64 MiB JSON plus 3072-element vectors is processed without a
      // table-sized JS retention. Native vectors never cross the source wire.
      expect(peakHeapGrowth).toBeLessThan(64 * 1024 * 1024);
    } finally {
      await client.query(`DROP TABLE ${table}`);
      await writer.query(`DROP TABLE ${destination}`);
      await writer.end();
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
});
