import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = new URL(
  "../prisma/migrations/20260923054500_customer_principal_auth_convergence/migration.sql",
  import.meta.url,
);

describe("customer Principal authentication convergence migration", () => {
  it("refuses split contact/email authority before changing populated data", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toMatch(/RAISE EXCEPTION[\s\S]*customer principal alias conflict/i);
    expect(sql).toMatch(/customer_contact/);
    expect(sql).toMatch(/lower\(cc\.email\)/i);
  });

  it("uses idempotent set-based writes and publishes a bounded invariant aggregate", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toMatch(/ON CONFLICT[\s\S]*DO NOTHING/i);
    expect(sql).toMatch(/CREATE OR REPLACE VIEW "CustomerPrincipalAuthInvariant"/);
    expect(sql).toMatch(/COUNT\(\*\) FILTER/i);
    expect(sql).not.toMatch(/LIMIT\s+\d+[\s\S]*INSERT/i);
  });
});
