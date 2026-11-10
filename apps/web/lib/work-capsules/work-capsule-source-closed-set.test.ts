import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { WORK_CAPSULE_SOURCES } from "@/lib/work-capsules";

// WorkCapsule.source is a closed set held in two places: WORK_CAPSULE_SOURCES
// in TypeScript and the "WorkCapsule_source_closed_set" CHECK in Postgres. They
// drifted twice — 20260902040000 for the employment sources, then
// "platform-maintenance" (BI-A5EEB5D1), whose row could never be updated. The
// migration is NOT VALID, so a value the code accepts but the check does not
// fails only at the first UPDATE, long after the INSERT. This test makes the
// drift a red build instead of a production 23514.
const MIGRATIONS_DIR = fileURLToPath(new URL("../../../../packages/db/prisma/migrations/", import.meta.url));

function latestDbClosedSet(): string[] {
  const dirs = readdirSync(MIGRATIONS_DIR).filter((d) => /^\d{14}_/.test(d)).sort();
  for (const dir of [...dirs].reverse()) {
    let sql: string;
    try {
      sql = readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");
    } catch {
      continue;
    }
    const block = sql.match(/"WorkCapsule_source_closed_set" CHECK \(\s*source = ANY \(ARRAY\[([\s\S]*?)\]\)/);
    if (block) return [...block[1].matchAll(/'([^']+)'::text/g)].map((m) => m[1]).sort();
  }
  throw new Error("no migration defines WorkCapsule_source_closed_set");
}

describe("WorkCapsule.source closed set", () => {
  it("is the same set in TypeScript and in the latest Postgres check constraint", () => {
    expect(latestDbClosedSet()).toEqual([...WORK_CAPSULE_SOURCES].sort());
  });
});
