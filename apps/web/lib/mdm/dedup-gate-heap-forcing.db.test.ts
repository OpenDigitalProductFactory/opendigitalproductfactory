// Functional proof for BI-FEAEB715: the heap-forcing wrapper actually changes
// the PLAN for an exact-equality candidate arm from an index scan (which a
// collation-drifted btree makes descend the wrong subtree and miss the row) to
// a sequential heap scan (which reads the true heap and cannot be fooled by a
// stale index). Runs against a real Postgres in an isolated scratch schema;
// skips cleanly when no DATABASE_URL is reachable.
//
// This isolates the MECHANISM the gate relies on, without needing the full
// application schema: an email-equality lookup over a btree-indexed column, run
// once normally and once under the same `SET LOCAL enable_*scan = off` sequence
// runHeapForcedCandidateQuery emits.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://dpf:dpf_dev@localhost:54329/dpf";
const SCHEMA = "dedup_heap_forcing_test";

let client: pg.Client | undefined;
let reachable = false;

beforeAll(async () => {
  client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    reachable = true;
  } catch {
    reachable = false;
    return;
  }
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await client.query(`
    CREATE TABLE "Contact" (
      id text PRIMARY KEY,
      email text NOT NULL
    )`);
  // Enough rows that the planner prefers the index for an equality probe.
  await client.query(
    `INSERT INTO "Contact" SELECT 'id' || g, 'user' || g || '@example.com' FROM generate_series(1, 5000) g`,
  );
  await client.query(`INSERT INTO "Contact" VALUES ('dup', 'target@example.com')`);
  await client.query(`CREATE INDEX "Contact_email_idx" ON "Contact" (email)`);
  await client.query(`ANALYZE "Contact"`);
});

afterAll(async () => {
  if (client && reachable) {
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
  }
  await client?.end().catch(() => {});
});

async function planFor(sql: string): Promise<string> {
  const c = client!;
  const res = await c.query(`EXPLAIN (COSTS OFF) ${sql}`);
  return res.rows.map((r) => r["QUERY PLAN"]).join("\n");
}

describe("heap-forcing flips the exact-equality plan (BI-FEAEB715)", () => {
  const EQ = `SELECT id FROM "${SCHEMA}"."Contact" WHERE email = 'target@example.com'`;

  it("uses an index scan for an exact email probe WITHOUT heap-forcing (the vulnerable plan)", async (ctx) => {
    if (!reachable) ctx.skip();
    await client!.query(`SET search_path TO ${SCHEMA}`);
    await client!.query("RESET enable_indexscan");
    await client!.query("RESET enable_bitmapscan");
    const plan = await planFor(EQ);
    expect(plan).toMatch(/Index Scan|Bitmap Index Scan/);
    expect(plan).not.toMatch(/Seq Scan/);
  });

  it("forces a Seq Scan under the exact GUCs the gate sets — reads the true heap", async (ctx) => {
    if (!reachable) ctx.skip();
    const c = client!;
    await c.query("BEGIN");
    try {
      await c.query(`SET LOCAL search_path TO ${SCHEMA}`);
      // The exact three statements runHeapForcedCandidateQuery emits.
      await c.query("SET LOCAL enable_indexscan = off");
      await c.query("SET LOCAL enable_indexonlyscan = off");
      await c.query("SET LOCAL enable_bitmapscan = off");
      const plan = await planFor(EQ);
      expect(plan).toMatch(/Seq Scan/);
      expect(plan).not.toMatch(/Index Scan/);
      // And it still finds the row — the point of the whole exercise.
      const rows = await c.query(EQ);
      expect(rows.rows.map((r) => r.id)).toEqual(["dup"]);
    } finally {
      await c.query("ROLLBACK");
    }
  });

  it("reverts to the index plan after the transaction (SET LOCAL is scoped)", async (ctx) => {
    if (!reachable) ctx.skip();
    await client!.query(`SET search_path TO ${SCHEMA}`);
    const plan = await planFor(EQ);
    expect(plan).toMatch(/Index Scan|Bitmap Index Scan/);
  });
});
