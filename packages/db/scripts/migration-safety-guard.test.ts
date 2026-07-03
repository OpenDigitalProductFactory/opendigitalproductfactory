import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs guard, no types
import { analyzeMigration, analyzeAddColumnNotNull, splitStatements, stripComments } from "./migration-safety-guard.mjs";

describe("migration-safety-guard", () => {
  it("FLAGS the real PR #2554 regression: EXCLUDE on an existing table, no remediation", () => {
    const sql = `
      CREATE EXTENSION IF NOT EXISTS btree_gist;
      ALTER TABLE "StorefrontBooking"
        ADD CONSTRAINT "StorefrontBooking_no_overlap"
        EXCLUDE USING gist ("providerId" WITH =, tsrange("scheduledAt", "scheduledAt") WITH &&)
        WHERE ("status" <> 'cancelled');`;
    const f = analyzeMigration(sql);
    expect(f).toHaveLength(1);
    expect(f[0].table).toBe("StorefrontBooking");
    expect(f[0].kind).toMatch(/ADD CONSTRAINT/);
  });

  it("PASSES when the same table is remediated earlier in the migration", () => {
    const sql = `
      ALTER TABLE "StorefrontBooking" ADD COLUMN "overlapQuarantinedAt" TIMESTAMP(3);
      DO $$ BEGIN
        UPDATE "StorefrontBooking" SET "overlapQuarantinedAt" = now() WHERE id = 'x';
      END $$;
      ALTER TABLE "StorefrontBooking"
        ADD CONSTRAINT "StorefrontBooking_no_overlap"
        EXCLUDE USING gist ("providerId" WITH =, tsrange("scheduledAt","scheduledAt") WITH &&);`;
    expect(analyzeMigration(sql)).toHaveLength(0);
  });

  it("PASSES a constraint on a table CREATE'd in the same migration (fresh table)", () => {
    const sql = `
      CREATE TABLE "NewThing" (id text PRIMARY KEY, ref text);
      ALTER TABLE "NewThing" ADD CONSTRAINT "NewThing_ref_key" UNIQUE (ref);`;
    expect(analyzeMigration(sql)).toHaveLength(0);
  });

  it("PASSES a FOREIGN KEY added NOT VALID (deferred validation)", () => {
    const sql = `ALTER TABLE "Order" ADD CONSTRAINT "Order_fk" FOREIGN KEY ("userId") REFERENCES "User"(id) NOT VALID;`;
    expect(analyzeMigration(sql)).toHaveLength(0);
  });

  it("PASSES when the author attests data-safe with a reason", () => {
    const sql = `
      -- @migration-safety: data-safe: providerId+slot pair is generated unique in code, no legacy rows
      ALTER TABLE "StorefrontBooking" ADD CONSTRAINT "sb_u" UNIQUE ("providerId", "scheduledAt");`;
    expect(analyzeMigration(sql)).toHaveLength(0);
  });

  it("FLAGS CREATE UNIQUE INDEX on an existing table without remediation", () => {
    const sql = `CREATE UNIQUE INDEX "user_email_key" ON "User" ("email");`;
    const f = analyzeMigration(sql);
    expect(f).toHaveLength(1);
    expect(f[0].table).toBe("User");
  });

  it("FLAGS SET NOT NULL on an existing column without remediation", () => {
    const sql = `ALTER TABLE "User" ALTER COLUMN "email" SET NOT NULL;`;
    expect(analyzeMigration(sql)).toHaveLength(1);
  });

  it("FLAGS ADD COLUMN NOT NULL without a DEFAULT", () => {
    const sql = `ALTER TABLE "User" ADD COLUMN "tier" text NOT NULL;`;
    expect(analyzeAddColumnNotNull(sql)).toHaveLength(1);
  });

  it("PASSES ADD COLUMN NOT NULL WITH a DEFAULT (Postgres backfills)", () => {
    const sql = `ALTER TABLE "User" ADD COLUMN "tier" text NOT NULL DEFAULT 'free';`;
    expect(analyzeAddColumnNotNull(sql)).toHaveLength(0);
  });

  it("PASSES a purely additive nullable column migration", () => {
    const sql = `ALTER TABLE "User" ADD COLUMN "nickname" text;`;
    expect(analyzeMigration(sql)).toHaveLength(0);
    expect(analyzeAddColumnNotNull(sql)).toHaveLength(0);
  });

  it("does not split ; inside a $$ dollar-quoted block", () => {
    const sql = `DO $$ BEGIN UPDATE "T" SET a = 1; UPDATE "T" SET b = 2; END $$;`;
    expect(splitStatements(stripComments(sql))).toHaveLength(1);
  });
});
