// Functional proof for buildExactKeyRepairSql (BI-8EEEF8CB): the emitted SQL is
// executed against a real Postgres, against real seeded duplicates, and the
// repaired state is asserted. A structural test proves the SQL is SHAPED right;
// this proves it WORKS — dedupes, retires losers, and rebuilds the index.
//
// Uses an isolated scratch schema so it touches no platform table. Skips
// cleanly when DATABASE_URL is unset (e.g. a source-only checkout).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { buildExactKeyRepairSql } from "./exact-key-repair";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://dpf:dpf_dev@localhost:15432/dpf";
const SCHEMA = "exact_key_repair_test";

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
});

afterAll(async () => {
  if (client && reachable) {
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
  }
  await client?.end().catch(() => {});
});

describe("buildExactKeyRepairSql executed against Postgres", () => {
  it("dedupes a corrupted unique key, retires losers, and rebuilds the index", async (ctx) => {
    if (!reachable) ctx.skip();
    const c = client!;
    await c.query(`SET search_path TO ${SCHEMA}`);

    // A table standing in for a real one: a natural key, a status column (the
    // retirement target), and timestamps for survivor ranking.
    await c.query(`
      CREATE TABLE "Widget" (
        id text PRIMARY KEY,
        "widgetKey" text NOT NULL,
        status text NOT NULL DEFAULT 'active',
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);

    // Two logical keys, each with duplicates. The SURVIVOR is the oldest row.
    await c.query(`
      INSERT INTO "Widget" (id, "widgetKey", status, "createdAt") VALUES
        ('w-alpha-old',   'alpha', 'active', '2026-01-01'),
        ('w-alpha-mid',   'alpha', 'active', '2026-02-01'),
        ('w-alpha-new',   'alpha', 'active', '2026-03-01'),
        ('w-beta-old',    'beta',  'active', '2026-01-15'),
        ('w-beta-new',    'beta',  'active', '2026-02-15'),
        ('w-gamma-only',  'gamma', 'active', '2026-01-20')`);

    // Build the index the "corrupted" way: it exists, but the heap holds dupes.
    // (We create it non-unique to allow the duplicate seed; the repair drops and
    // recreates it UNIQUE from the repaired heap — exactly the real scenario
    // where a collation flip let a UNIQUE index accumulate duplicates.)
    await c.query(`CREATE INDEX "Widget_widgetKey_key" ON "Widget" ("widgetKey")`);

    const sql = buildExactKeyRepairSql({
      table: "Widget",
      keyColumns: ["widgetKey"],
      survivorOrder: '"createdAt" ASC, id ASC',
      uniqueIndexName: "Widget_widgetKey_key",
      retirement: [{ column: "status", value: "'retired'" }],
      reason: "BI-TEST — functional repair of Widget.",
    });

    // The generated migration is schema-agnostic; run it on the search_path.
    await c.query(`SET search_path TO ${SCHEMA}`);
    await c.query(sql);

    // 1. No duplicate logical keys remain among LIVE rows.
    const live = await c.query(
      `SELECT "widgetKey", count(*) c FROM "Widget" WHERE status = 'active' GROUP BY "widgetKey" ORDER BY "widgetKey"`,
    );
    expect(live.rows).toEqual([
      { widgetKey: "alpha", c: "1" },
      { widgetKey: "beta", c: "1" },
      { widgetKey: "gamma", c: "1" },
    ]);

    // 2. The SURVIVOR is the oldest row, key intact, still active.
    const survivors = await c.query(
      `SELECT id FROM "Widget" WHERE status = 'active' ORDER BY id`,
    );
    expect(survivors.rows.map((r) => r.id)).toEqual([
      "w-alpha-old",
      "w-beta-old",
      "w-gamma-only",
    ]);

    // 3. Losers are RETIRED (the #3374 gap) and renamed into the reserved
    //    namespace — retained, never deleted.
    const losers = await c.query(
      `SELECT id, "widgetKey", status FROM "Widget" WHERE status = 'retired' ORDER BY id`,
    );
    expect(losers.rows.map((r) => r.id).sort()).toEqual(["w-alpha-mid", "w-alpha-new", "w-beta-new"]);
    for (const row of losers.rows) {
      expect(row.status).toBe("retired");
      expect(row.widgetKey).toMatch(/^__dpf_quarantined__/);
    }

    // 4. The rebuilt index is genuinely UNIQUE — a duplicate insert now fails.
    await expect(
      c.query(`INSERT INTO "Widget" (id, "widgetKey") VALUES ('w-dup', 'alpha')`),
    ).rejects.toThrow();

    // 5. Nothing was lost: all six original rows still exist.
    const total = await c.query(`SELECT count(*)::int AS n FROM "Widget"`);
    expect(total.rows[0].n).toBe(6);
  });

  it("is idempotent — a second run on a clean heap changes nothing and still asserts", async (ctx) => {
    if (!reachable) ctx.skip();
    const c = client!;
    await c.query(`SET search_path TO ${SCHEMA}`);
    await c.query(`DROP TABLE IF EXISTS "Clean"`);
    await c.query(`
      CREATE TABLE "Clean" (id text PRIMARY KEY, k text NOT NULL, status text NOT NULL DEFAULT 'active')`);
    await c.query(`INSERT INTO "Clean" (id, k) VALUES ('a','1'),('b','2')`);
    await c.query(`CREATE UNIQUE INDEX "Clean_k_key" ON "Clean" (k)`);

    const sql = buildExactKeyRepairSql({
      table: "Clean",
      keyColumns: ["k"],
      survivorOrder: "id",
      uniqueIndexName: "Clean_k_key",
      retirement: [{ column: "status", value: "'retired'" }],
      reason: "BI-TEST — idempotent no-op.",
    });
    await c.query(`SET search_path TO ${SCHEMA}`);
    await c.query(sql);

    const rows = await c.query(`SELECT status FROM "Clean" ORDER BY id`);
    // No duplicates existed, so nothing was retired.
    expect(rows.rows.every((r) => r.status === "active")).toBe(true);
  });
});
