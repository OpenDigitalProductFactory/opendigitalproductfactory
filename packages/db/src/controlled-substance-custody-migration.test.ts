// EP-CSC-CUSTODY / BI-3810ED3A: the controlled-substance custody migration must
// apply against any data state (AGENTS.md §2) and must make history
// append-only, tenant-safe and arithmetically sound at the database (AC-CSC-001).
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const migrationPath = new URL(
  "../prisma/migrations/20260930120000_controlled_substance_custody/migration.sql",
  import.meta.url,
);

const TABLES = [
  "ControlledSubstanceProduct",
  "ControlledSubstanceRegister",
  "ControlledSubstanceHandlerAuthorization",
  "ControlledSubstanceMovement",
  "ControlledSubstanceCount",
  "ControlledSubstanceCountLine",
  "ControlledSubstanceDiscrepancy",
];

describe("controlled-substance custody migration shape", () => {
  it("creates new objects only and writes no rows", async () => {
    const sql = (await readFile(migrationPath, "utf8")).replace(/^--.*$/gm, "");
    expect(sql).not.toMatch(/^\s*(UPDATE|INSERT|DELETE|DROP TABLE|DROP COLUMN)\b/im);
    expect(sql).not.toMatch(/ALTER TABLE "(?!ControlledSubstance)\w+"/);
  });

  it("makes movements, counts and count lines append-only and evidence undeletable", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const table of ["ControlledSubstanceMovement", "ControlledSubstanceCount", "ControlledSubstanceCountLine"]) {
      expect(sql).toMatch(new RegExp(`BEFORE UPDATE OR DELETE ON "${table}"`));
    }
    for (const table of ["ControlledSubstanceDiscrepancy", "ControlledSubstanceHandlerAuthorization"]) {
      expect(sql).toMatch(new RegExp(`BEFORE DELETE ON "${table}"`));
    }
  });

  it("forces organization row-level security on every table", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const table of TABLES) {
      expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`CREATE POLICY "${table}_organization_policy"`);
    }
  });

  it("never cascades a delete into retained evidence", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).not.toMatch(/ON DELETE (CASCADE|SET NULL)/);
  });
});

describeDatabase("controlled-substance custody migration against live Postgres", () => {
  let client: Client;
  let schema: string;
  // Row-level security binds only roles without BYPASSRLS, and a superuser
  // always bypasses it. The isolation assertion runs as a dedicated
  // non-superuser role so it tests the policy, not the connecting role.
  const tenantRole = `cs_rls_${randomUUID().replaceAll("-", "").slice(0, 16)}`;

  async function asOrg(org: string): Promise<void> {
    await client.query(`SELECT set_config('app.organization_id', $1, false)`, [org]);
  }

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    schema = `cs_custody_${randomUUID().replaceAll("-", "")}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TYPE "RecordLifecycle" AS ENUM ('active', 'archived', 'retired', 'superseded', 'merged', 'quarantined');
      CREATE TABLE "Organization" (id TEXT PRIMARY KEY);
      CREATE TABLE "Principal" (id TEXT PRIMARY KEY);
      CREATE TABLE "OrganizationLicenseRecord" (id TEXT PRIMARY KEY);
      CREATE TABLE "PersonLicenseRecord" (id TEXT PRIMARY KEY);
      CREATE TABLE "CareLocation" (id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, UNIQUE (id, "organizationId"));
      CREATE TABLE "PatientProfile" (id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, UNIQUE (id, "organizationId"));
      CREATE TABLE "AnimalProfile" (id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, UNIQUE (id, "organizationId"));
      INSERT INTO "Organization" VALUES ('org-a'), ('org-b');
      INSERT INTO "Principal" VALUES ('p-julia'), ('p-theo');
      INSERT INTO "OrganizationLicenseRecord" VALUES ('lic-a');
      INSERT INTO "PatientProfile" VALUES ('pat-a', 'org-a'), ('pat-b', 'org-b');
    `);
    await client.query(await readFile(migrationPath, "utf8"));
    await asOrg("org-a");
    await client.query(`
      INSERT INTO "ControlledSubstanceProduct" (id, "productRef", "organizationId", name, "activeIngredient", strength, "dosageForm", schedule, "baseUnit", "updatedAt")
        VALUES ('prod-a', 'CSP-A', 'org-a', 'Hydromorphone', 'hydromorphone', '2 mg/mL', 'injection', 'c_ii', 'milliliter', now());
      INSERT INTO "ControlledSubstanceRegister" (id, "registerRef", "organizationId", "organizationLicenseRecordId", "storageLabel", "updatedAt")
        VALUES ('reg-a', 'CSR-A', 'org-a', 'lic-a', 'Safe A', now());
    `);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query("RESET ROLE");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.query(`DROP ROLE IF EXISTS "${tenantRole}"`);
    await client.end();
  });

  async function insertMovement(overrides: Record<string, unknown> = {}): Promise<void> {
    const row = {
      id: randomUUID(),
      movementRef: `CSM-${randomUUID()}`,
      organizationId: "org-a",
      registerId: "reg-a",
      productId: "prod-a",
      sequence: 1,
      kind: "receipt",
      quantityDelta: "10",
      balanceBefore: "0",
      balanceAfter: "10",
      occurredAt: new Date().toISOString(),
      actorPrincipalId: "p-julia",
      entryHash: randomUUID(),
      ...overrides,
    };
    const columns = Object.keys(row);
    await client.query(
      `INSERT INTO "ControlledSubstanceMovement" (${columns.map((c) => `"${c}"`).join(", ")})
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
      Object.values(row),
    );
  }

  it("accepts a well-formed movement and refuses to update or delete it", async () => {
    await insertMovement({ id: "m-1" });
    await expect(client.query(`UPDATE "ControlledSubstanceMovement" SET reason = 'edit' WHERE id = 'm-1'`)).rejects.toThrow(
      /append-only/,
    );
    await expect(client.query(`DELETE FROM "ControlledSubstanceMovement" WHERE id = 'm-1'`)).rejects.toThrow(/append-only/);
  });

  it("refuses broken arithmetic, a negative balance, a self-witness and a duplicate sequence", async () => {
    await expect(insertMovement({ sequence: 2, balanceBefore: "10", balanceAfter: "11", quantityDelta: "-1" })).rejects.toThrow(
      /balance_arithmetic/,
    );
    await expect(insertMovement({ sequence: 2, balanceBefore: "0", balanceAfter: "-1", quantityDelta: "-1" })).rejects.toThrow(
      /balance_arithmetic/,
    );
    await expect(insertMovement({ sequence: 2, witnessPrincipalId: "p-julia" })).rejects.toThrow(/witness_not_actor/);
    await expect(insertMovement({ sequence: 1 })).rejects.toThrow(/unique/i);
  });

  it("refuses a patient from another organization", async () => {
    await expect(
      insertMovement({ sequence: 2, kind: "administration", quantityDelta: "-1", balanceBefore: "10", balanceAfter: "9", patientProfileId: "pat-b" }),
    ).rejects.toThrow(/foreign key/i);
  });

  it("requires exactly one registrant on a register", async () => {
    await expect(
      client.query(`
        INSERT INTO "ControlledSubstanceRegister" (id, "registerRef", "organizationId", "storageLabel", "updatedAt")
        VALUES ('reg-none', 'CSR-NONE', 'org-a', 'Lockbox', now())`),
    ).rejects.toThrow(/exactly_one_registrant/);
  });

  it("hides one organization's register from another for a role bound by row-level security", async () => {
    await client.query(`CREATE ROLE "${tenantRole}" NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${tenantRole}"`);
    await client.query(`GRANT SELECT ON "ControlledSubstanceMovement" TO "${tenantRole}"`);
    try {
      await client.query(`SET ROLE "${tenantRole}"`);
      await asOrg("org-b");
      const hidden = await client.query(`SELECT count(*)::int AS n FROM "ControlledSubstanceMovement"`);
      expect(hidden.rows[0].n).toBe(0);
      await asOrg("org-a");
      const visible = await client.query(`SELECT count(*)::int AS n FROM "ControlledSubstanceMovement"`);
      expect(visible.rows[0].n).toBe(1);
      await client.query(`SELECT set_config('app.organization_id', '', false)`);
      const unset = await client.query(`SELECT count(*)::int AS n FROM "ControlledSubstanceMovement"`);
      expect(unset.rows[0].n).toBe(0);
    } finally {
      await client.query("RESET ROLE");
      await asOrg("org-a");
    }
  });
});
