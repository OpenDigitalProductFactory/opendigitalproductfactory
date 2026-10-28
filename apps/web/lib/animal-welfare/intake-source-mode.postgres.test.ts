import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CARE_INTAKE_SOURCE_MODES } from "@dpf/db/healthcare-care-intake";

import { ANIMAL_INTAKE_SOURCE_MODE } from "./intake-repository";

// BI-6A41ADCD: the unit suite injects a client that never runs a CHECK
// constraint, so "operator" passed every test while every real admission was
// refused with 23514. This reads the migrated constraints themselves and
// evaluates the mode rescue intake writes against them. Read-only.
const url = process.env.DPF_SQL_TEST_DATABASE_URL
  ?? (process.env.CI === "true" ? process.env.DATABASE_URL : undefined);
const databaseSuite = url ? describe : describe.skip;

const CONSTRAINTS = [
  ["CareIntakePacket", "CareIntakePacket_source_mode_check"],
  ["CareIntakeStatusEvent", "CareIntakeStatusEvent_source_mode_check"],
] as const;

databaseSuite("rescue intake source mode on PostgreSQL", () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: url, options: "-c default_transaction_read_only=on -c statement_timeout=5000" });
    await client.connect();
  });
  afterAll(async () => { await client?.end(); });

  async function definition(table: string, name: string): Promise<string> {
    const { rows } = await client.query<{ def: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = $1 AND c.conname = $2`,
      [table, name],
    );
    expect(rows, `${name} exists`).toHaveLength(1);
    return rows[0]!.def;
  }

  for (const [table, name] of CONSTRAINTS) {
    it(`${name} accepts the mode rescue intake writes, and matches the shared vocabulary`, async () => {
      const def = await definition(table, name);
      const allowed = [...def.matchAll(/'([^']+)'::text/g)].map((match) => match[1]).sort();
      expect(allowed).toEqual([...CARE_INTAKE_SOURCE_MODES].sort());
      expect(allowed).toContain(ANIMAL_INTAKE_SOURCE_MODE);
    });
  }
});
