import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseApplicability } from "./regulation-applicability";
import { BANKING_REGULATIONS } from "./seed-banking-compliance";
import { PUBLIC_SECTOR_REGULATIONS } from "./seed-public-sector-compliance";
import { LAW_ENFORCEMENT_REGULATIONS } from "./seed-law-enforcement-compliance";
import { COOPERATIVE_REGULATIONS } from "./seed-cooperative-compliance";

// BI-9DED0CE8 — every wholesale-seeded industry pack regulation must carry a
// structured applicability spec, so an install is only in scope when its
// setup-chosen archetype matches. Without a spec a regulation falls back to
// the legacy industry string matcher and surfaces as noise on installs the
// regime does not pertain to.

const PACKS = [
  ["banking", BANKING_REGULATIONS],
  ["public-sector", PUBLIC_SECTOR_REGULATIONS],
  ["law-enforcement", LAW_ENFORCEMENT_REGULATIONS],
  ["cooperative", COOPERATIVE_REGULATIONS],
] as const;

describe("industry compliance packs carry archetype-scoped applicability", () => {
  for (const [pack, regulations] of PACKS) {
    it(`${pack}: every regulation has a parseable, archetype-gated spec`, () => {
      for (const reg of regulations) {
        // Round-trip through the tolerant parser used at classification time —
        // a spec the parser rejects would silently fall back to legacy matching.
        const parsed = parseApplicability(JSON.parse(JSON.stringify(reg.applicability)));
        expect(parsed, `${reg.regulationId} spec must parse`).not.toBeNull();
        expect(parsed!.archetypes, `${reg.regulationId} must gate on archetypes`).toBeDefined();
        expect(parsed!.archetypes!.length).toBeGreaterThan(0);
        expect(parsed!.basis.length).toBeGreaterThan(0);
      }
    });
  }
});

describe("backfill migration stays in lockstep with the pack seed specs", () => {
  // The data-only migration (20260710150000) backfills applicability on
  // EXISTING installs; the seed populates fresh ones. If a spec changes in a
  // pack without the migration (or a follow-up migration) matching, existing
  // installs classify differently from fresh installs.
  const sql = readFileSync(
    join(
      __dirname,
      "../prisma/migrations/20260710150000_backfill_pack_regulation_applicability/migration.sql",
    ),
    "utf8",
  );

  const migrationSpecByRegulationId = new Map<string, unknown>();
  const statement = /SET "applicability" = '([^']+)'::jsonb\s+WHERE "regulationId" (?:= '([^']+)'|IN \(([^)]+)\))/g;
  for (const match of sql.matchAll(statement)) {
    const spec = JSON.parse(match[1]!);
    const ids = match[2]
      ? [match[2]]
      : match[3]!.split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
    for (const id of ids) migrationSpecByRegulationId.set(id, spec);
  }

  for (const [pack, regulations] of PACKS) {
    it(`${pack}: migration backfills the same spec the seed writes`, () => {
      for (const reg of regulations) {
        expect(
          migrationSpecByRegulationId.get(reg.regulationId),
          `${reg.regulationId} must be backfilled by the migration`,
        ).toEqual(JSON.parse(JSON.stringify(reg.applicability)));
      }
    });
  }
});
