/**
 * BI-9F7192F9 phase 1 (AC-E3): the retained S5 rehearsal requester enrollment
 * record against a real PostgreSQL.
 *
 * Runs only when DPF_S5_REQUESTER_TEST_DATABASE_URL names a DISPOSABLE
 * database (a throwaway container or the dev DB, never the live install).
 * Without it every case is SKIPPED. The suite builds its own schema holding
 * minimal stub "User" and "Principal" tables plus the shared
 * "RecordLifecycle" enum, applies the committed migration there, and drops
 * the schema at the end. It never touches another schema.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DPF_S5_REQUESTER_TEST_DATABASE_URL?.trim() ?? "";
const MIGRATION = join(
  __dirname,
  "../prisma/migrations/20261126090000_s5_rehearsal_requester_enrollment/migration.sql",
);
const SCHEMA = `s5rr_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
const TABLE = `"S5RehearsalRequesterEnrollment"`;

type PgError = { code?: string; message?: string };

async function failure(promise: Promise<unknown>): Promise<PgError> {
  try {
    await promise;
  } catch (error) {
    return error as PgError;
  }
  throw new Error("expected the statement to be refused");
}

describe.skipIf(!DATABASE_URL)("S5 rehearsal requester enrollment record (real database)", () => {
  let admin: Pool;
  let db: Pool;
  let row = 0;

  const insert = (overrides: Record<string, unknown> = {}) => {
    row += 1;
    const values: Record<string, unknown> = {
      id: `enr-${row}`,
      setupDigest: `digest-${row}`,
      rulingRef: "ruling:test",
      reservationRef: `reservation:${row}`,
      attemptRef: `attempt:${row}`,
      fixtureRef: "fixture:test",
      installationRef: "installation:test",
      leaseRef: "lease:test",
      dbIdentityRef: "db:test",
      userId: `user-${row}`,
      principalId: `principal-${row}`,
      enrolledByPrincipalId: "principal-owner",
      ...overrides,
    };
    const columns = Object.keys(values);
    const sql = `INSERT INTO ${TABLE} (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns
      .map((_, i) => `$${i + 1}`)
      .join(", ")})`;
    return db.query(sql, Object.values(values));
  };

  const seedSubject = async (n: number) => {
    await db.query(`INSERT INTO "User"(id) VALUES ($1)`, [`user-${n}`]);
    await db.query(`INSERT INTO "Principal"(id) VALUES ($1)`, [`principal-${n}`]);
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: DATABASE_URL, max: 1 });
    await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
    db = new Pool({ connectionString: DATABASE_URL, max: 2, options: `-c search_path="${SCHEMA}"` });
    await db.query(`CREATE TYPE "RecordLifecycle" AS ENUM ('active', 'archived', 'retired', 'superseded', 'merged')`);
    await db.query(`CREATE TABLE "User" (id TEXT PRIMARY KEY)`);
    await db.query(`CREATE TABLE "Principal" (id TEXT PRIMARY KEY)`);
    await db.query(`INSERT INTO "Principal"(id) VALUES ('principal-owner'), ('principal-retirer'), ('principal-unrelated')`);
    await db.query(readFileSync(MIGRATION, "utf8"));
  }, 30_000);

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await admin?.end();
  });

  it("creates the table in the test schema only, with the FK indexes and no lifecycle index", async () => {
    const tables = await admin.query(
      `SELECT table_schema FROM information_schema.tables WHERE table_name = 'S5RehearsalRequesterEnrollment' AND table_schema = $1`,
      [SCHEMA],
    );
    expect(tables.rowCount).toBe(1);
    const indexes = await admin.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'S5RehearsalRequesterEnrollment'`, [SCHEMA]);
    const defs = indexes.rows.map((r: { indexdef: string }) => r.indexdef).join("\n");
    expect(defs).toContain(`("setupDigest")`);
    expect(defs).toContain(`("userId")`);
    expect(defs).toContain(`("principalId")`);
    expect(defs).toContain(`("enrolledByPrincipalId")`);
    expect(defs).toContain(`("retiredByPrincipalId")`);
    expect(defs).not.toContain(`("lifecycle")`);
  });

  it("enforces one enrollment per setup digest, user and principal", async () => {
    await seedSubject(1);
    await insert({ id: "enr-a", setupDigest: "digest-unique", userId: "user-1", principalId: "principal-1" });
    await seedSubject(2);
    const duplicate = await failure(insert({ setupDigest: "digest-unique", userId: "user-2", principalId: "principal-2" }));
    expect(duplicate.code).toBe("23505");
    const sameUser = await failure(insert({ setupDigest: "digest-other", userId: "user-1", principalId: "principal-2" }));
    expect(sameUser.code).toBe("23505");
  });

  it("rejects any change to a fact column", async () => {
    for (const [column, value] of [
      ["setupDigest", "digest-changed"],
      ["rulingRef", "ruling:changed"],
      ["reservationRef", "reservation:changed"],
      ["attemptRef", "attempt:changed"],
      ["fixtureRef", "fixture:changed"],
      ["installationRef", "installation:changed"],
      ["leaseRef", "lease:changed"],
      ["dbIdentityRef", "db:changed"],
      ["enrolledByPrincipalId", "principal-unrelated"],
      ["enrolledAt", new Date("2020-01-01T00:00:00Z")],
    ] as const) {
      const refused = await failure(db.query(`UPDATE ${TABLE} SET "${column}" = $1 WHERE id = 'enr-a'`, [value]));
      expect(refused.message, column).toContain("S5RehearsalRequesterEnrollment facts are immutable");
    }
  });

  it("rejects a partial or non-terminal lifecycle tuple on insert and update", async () => {
    await seedSubject(3);
    const retiredWithoutTerminalFields = await failure(
      insert({ userId: "user-3", principalId: "principal-3", lifecycle: "retired" }),
    );
    expect(retiredWithoutTerminalFields.code).toBe("23514");
    const activeWithReason = await failure(
      insert({ userId: "user-3", principalId: "principal-3", retirementReason: "operator_cleanup" }),
    );
    expect(activeWithReason.code).toBe("23514");
    const archived = await failure(insert({ userId: "user-3", principalId: "principal-3", lifecycle: "archived" }));
    expect(archived.code).toBe("23514");
    const partialRetire = await failure(
      db.query(`UPDATE ${TABLE} SET lifecycle = 'retired', "lifecycleAt" = now() WHERE id = 'enr-a'`),
    );
    expect(partialRetire.code).toBe("23514");
  });

  it("allows exactly one active -> retired transition, written once", async () => {
    await db.query(
      `UPDATE ${TABLE} SET lifecycle = 'retired', "lifecycleAt" = now(), "retirementReason" = 'rehearsal_complete', "retiredByPrincipalId" = 'principal-retirer' WHERE id = 'enr-a'`,
    );
    const back = await failure(
      db.query(`UPDATE ${TABLE} SET lifecycle = 'active', "lifecycleAt" = NULL, "retirementReason" = NULL, "retiredByPrincipalId" = NULL WHERE id = 'enr-a'`),
    );
    expect(back.message).toContain("S5RehearsalRequesterEnrollment lifecycle may only move from active to retired");
    const rewrite = await failure(db.query(`UPDATE ${TABLE} SET "retirementReason" = 'operator_cleanup' WHERE id = 'enr-a'`));
    expect(rewrite.message).toContain("S5RehearsalRequesterEnrollment lifecycle may only move from active to retired");
  });

  it("refuses to delete an enrollment row", async () => {
    const refused = await failure(db.query(`DELETE FROM ${TABLE} WHERE id = 'enr-a'`));
    expect(refused.message).toContain("S5RehearsalRequesterEnrollment is retained and cannot be deleted");
    expect((await db.query(`SELECT 1 FROM ${TABLE} WHERE id = 'enr-a'`)).rowCount).toBe(1);
  });

  it("refuses deletes of every linked identity and allows unrelated deletes", async () => {
    for (const [table, id] of [
      ["User", "user-1"],
      ["Principal", "principal-1"],
      ["Principal", "principal-owner"],
      ["Principal", "principal-retirer"],
    ] as const) {
      const refused = await failure(db.query(`DELETE FROM "${table}" WHERE id = $1`, [id]));
      expect(refused.code, `${table} ${id}`).toBe("23503");
    }
    const unrelated = await db.query(`DELETE FROM "Principal" WHERE id = 'principal-unrelated'`);
    expect(unrelated.rowCount).toBe(1);
    const unrelatedUser = await db.query(`DELETE FROM "User" WHERE id = 'user-2'`);
    expect(unrelatedUser.rowCount).toBe(1);
  });

  it("re-applies cleanly (the migration's guard objects are idempotent)", async () => {
    // Prisma applies each migration once; this proves the guard functions and
    // triggers are declared with CREATE OR REPLACE / DROP IF EXISTS.
    const sql = readFileSync(MIGRATION, "utf8");
    const guardsOnly = sql.slice(sql.indexOf("-- Guards"));
    await db.query(guardsOnly);
    const refused = await failure(db.query(`DELETE FROM ${TABLE} WHERE id = 'enr-a'`));
    expect(refused.message).toContain("retained and cannot be deleted");
  });

  it("teardown drops the test schema", async () => {
    await db.end();
    await admin.query(`DROP SCHEMA "${SCHEMA}" CASCADE`);
    const left = await admin.query(`SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`, [SCHEMA]);
    expect(left.rowCount).toBe(0);
    db = undefined as unknown as Pool;
  });
});
