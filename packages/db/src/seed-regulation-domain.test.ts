import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { isRegulationDomain, REGULATION_DOMAINS } from "./regulation-applicability";
import { BANKING_REGULATIONS } from "./seed-banking-compliance";
import { PUBLIC_SECTOR_REGULATIONS } from "./seed-public-sector-compliance";
import { LAW_ENFORCEMENT_REGULATIONS } from "./seed-law-enforcement-compliance";
import { COOPERATIVE_REGULATIONS } from "./seed-cooperative-compliance";
import { UK_CORP_GOV_REGULATIONS } from "./seed-uk-corp-gov-compliance";
import { SOFTWARE_HORIZONTAL_REGULATIONS } from "./seed-software-horizontal-compliance";

// BI-0B867B67 — every seeded regulation must carry a valid functional domain so
// it rolls up under exactly one bucket in the by-function posture. A NULL/typo'd
// domain would create an orphan bucket; the backfill migration must also cover
// every seeded regulationId so existing installs classify the instant it runs.

const ALL_PACKS = [
  ["banking", BANKING_REGULATIONS],
  ["public-sector", PUBLIC_SECTOR_REGULATIONS],
  ["law-enforcement", LAW_ENFORCEMENT_REGULATIONS],
  ["cooperative", COOPERATIVE_REGULATIONS],
  ["uk-corp-gov", UK_CORP_GOV_REGULATIONS],
  ["software-horizontal", SOFTWARE_HORIZONTAL_REGULATIONS],
] as const;

describe("every seeded regulation carries a valid functional domain", () => {
  for (const [pack, regulations] of ALL_PACKS) {
    it(`${pack}: all domains are in the closed REGULATION_DOMAINS set`, () => {
      for (const reg of regulations) {
        expect(
          isRegulationDomain((reg as { domain?: string }).domain),
          `${reg.regulationId} domain '${(reg as { domain?: string }).domain}' must be a valid RegulationDomain`,
        ).toBe(true);
      }
    });
  }

  it("REGULATION_DOMAINS is a stable closed set (guards reject unknowns)", () => {
    expect(isRegulationDomain("hr-employment")).toBe(true);
    expect(isRegulationDomain("not-a-domain")).toBe(false);
    expect(isRegulationDomain(null)).toBe(false);
    expect(REGULATION_DOMAINS).toContain("cross-cutting");
  });
});

describe("domain backfill migration covers every seeded regulation", () => {
  const sql = readFileSync(
    join(__dirname, "../prisma/migrations/20260805100100_backfill_regulation_domain/migration.sql"),
    "utf8",
  );

  // Parse `SET "domain" = '<d>' … "regulationId" IN ('A','B',…)` blocks.
  const backfilled = new Map<string, string>();
  const stmt = /SET "domain" = '([^']+)'[\s\S]*?"regulationId" IN \(([^)]+)\)/g;
  for (const m of sql.matchAll(stmt)) {
    const domain = m[1]!;
    for (const id of m[2]!.split(",").map((s) => s.trim().replace(/^'|'$/g, ""))) {
      backfilled.set(id, domain);
    }
  }

  it("only assigns valid domains", () => {
    for (const [id, domain] of backfilled) {
      expect(isRegulationDomain(domain), `${id} backfilled to invalid domain '${domain}'`).toBe(true);
    }
  });

  for (const [pack, regulations] of ALL_PACKS) {
    it(`${pack}: migration domain matches the seed domain for every reg`, () => {
      for (const reg of regulations) {
        const seedDomain = (reg as { domain?: string }).domain;
        expect(
          backfilled.get(reg.regulationId),
          `${reg.regulationId} must be backfilled to its seed domain`,
        ).toBe(seedDomain);
      }
    });
  }
});
