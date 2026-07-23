import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MERGE_ADAPTERS } from "./merge";

/**
 * Adapter completeness guard (spec §5.4): every FK relation in schema.prisma
 * that points at a mergeable canonical model must be declared in that
 * domain's adapter (or explicitly waived here with a reason). A feature that
 * adds a new relation to CustomerAccount/CustomerSite without updating the
 * merge adapter fails this test instead of orphaning rows at merge time.
 *
 * Soft references have no schema relation to diff against — the adapter is
 * their single home (reviewed in PR); this guard covers the FK side.
 */

const SCHEMA_PATH = join(__dirname, "..", "..", "..", "..", "packages", "db", "prisma", "schema.prisma");

/** Relations intentionally NOT repointed, with the reason. */
const WAIVED: Record<string, string> = {
  // BI-DE47EC0B. PartnerProgramEnrollment is a 1:1 side table (accountId is
  // UNIQUE), so a blind repoint would violate that constraint whenever BOTH the
  // survivor and the loser are enrolled partners. Deciding WHICH tier, margin
  // and agreement survives is a commercial judgement, not something a generic
  // dedup may make silently. Waiving is safe and non-destructive: the loser
  // account row survives as a tombstone (mergedIntoId set), so the FK stays
  // valid, the commercial terms remain auditable on the superseded row, and the
  // enrolment is excluded from default reads along with its account. An explicit
  // partner-merge path lands with the partner portal (BI-00E69FBA).
  "PartnerProgramEnrollment.accountId":
    "1:1 partner side table — merging enrolled partners is an explicit commercial decision, not a silent repoint; the loser's enrolment stays auditable on its tombstoned account",
  "CustomerAccount.mergedIntoId":
    "the tombstone pointer itself — merged-away rows keep pointing at their survivor",
  "CustomerSite.mergedIntoId":
    "the tombstone pointer itself — merged-away rows keep pointing at their survivor",
  "CustomerContact.mergedIntoId":
    "the tombstone pointer itself — merged-away rows keep pointing at their survivor",
};

const MODEL_NAME: Record<string, string> = {
  "customer-account": "CustomerAccount",
  "customer-site": "CustomerSite",
  "customer-contact": "CustomerContact",
};

function lowerFirst(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/** Parse `Model.field` pairs for FK relations targeting `target`. */
function schemaRelationsTargeting(target: string): string[] {
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  const results: string[] = [];
  const modelBlocks = schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g);
  for (const [, modelName, body] of modelBlocks) {
    const relations = body!.matchAll(
      new RegExp(`\\w+\\s+${target}\\??\\s+@relation\\((?:"[^"]*",\\s*)?fields:\\s*\\[(\\w+)\\]`, "g"),
    );
    for (const [, field] of relations) {
      results.push(`${modelName}.${field}`);
    }
  }
  return results;
}

describe("merge adapter completeness", () => {
  for (const [domain, adapter] of Object.entries(MERGE_ADAPTERS)) {
    it(`${domain}: adapter declares every schema FK relation (or waives it)`, () => {
      const target = MODEL_NAME[domain]!;
      const schemaRelations = schemaRelationsTargeting(target);
      expect(schemaRelations.length).toBeGreaterThan(0);

      const declared = new Set(
        adapter.hardRelations.map((step) => `${step.model}.${step.field}`),
      );
      const missing = schemaRelations.filter((rel) => {
        if (WAIVED[rel]) return false;
        const [modelName, field] = rel.split(".");
        return !declared.has(`${lowerFirst(modelName!)}.${field}`);
      });
      expect(
        missing,
        `relations targeting ${target} missing from the ${domain} merge adapter ` +
          `(declare a RepointStep or add a WAIVED entry with a reason): ${missing.join(", ")}`,
      ).toEqual([]);
    });

    it(`${domain}: adapter does not declare relations the schema lacks`, () => {
      const target = MODEL_NAME[domain]!;
      const schemaRelations = new Set(
        schemaRelationsTargeting(target).map((rel) => {
          const [modelName, field] = rel.split(".");
          return `${lowerFirst(modelName!)}.${field}`;
        }),
      );
      const stale = adapter.hardRelations
        .map((step) => `${step.model}.${step.field}`)
        .filter((rel) => !schemaRelations.has(rel));
      expect(stale, `adapter steps with no matching schema relation: ${stale.join(", ")}`).toEqual(
        [],
      );
    });
  }
});
