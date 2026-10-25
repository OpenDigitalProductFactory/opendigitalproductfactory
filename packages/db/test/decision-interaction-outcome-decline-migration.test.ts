// BI-835F9A12: decline must be allowed by a NEW forward migration. The
// 20260517230000 migration is already applied and must stay byte-for-byte.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error — .mjs guard, no types
import { analyzeMigration } from "../scripts/migration-safety-guard.mjs";

const ORIGINAL_REL =
  "packages/db/prisma/migrations/20260517230000_add_decision_perspective/migration.sql";
const ORIGINAL_URL = new URL(`../prisma/migrations/20260517230000_add_decision_perspective/migration.sql`, import.meta.url);
const WIDENED_URL = new URL(
  "../prisma/migrations/20261025120000_widen_decision_interaction_outcome_type/migration.sql",
  import.meta.url,
);

// Frozen checksum of the applied migration. A change to that file fails here.
const ORIGINAL_SHA256 = "963f52e074b7a22ddb03e0aa540a7d6ead91999317a83fc481beb7402bafdb68";

const ORIGINAL_OUTCOME_CHECK =
  `ALTER TABLE "DecisionInteraction" ADD CONSTRAINT "DecisionInteraction_outcomeType_check" CHECK ("outcomeType" IN ('recommend', 'arbitrate', 'escalate', 'defer'));`;

describe("DecisionInteraction outcomeType decline migration (BI-835F9A12)", () => {
  it("allows decline and keeps recommend, arbitrate, escalate, and defer", () => {
    const sql = readFileSync(WIDENED_URL, "utf8");
    expect(sql).toContain("This only widens the allowed set, so every existing row stays valid.");
    expect(sql).toMatch(/--\s*@migration-safety:\s*data-safe:/);
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS "DecisionInteraction_outcomeType_check"');
    const checks = [...sql.matchAll(/CHECK\s*\(\s*"outcomeType"\s+IN\s*\(([^)]*)\)\s*\)/g)];
    expect(checks).toHaveLength(1);
    const values = [...checks[0][1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(values).toEqual(["recommend", "arbitrate", "escalate", "defer", "decline"]);
    expect(analyzeMigration(sql)).toEqual([]);
  });

  it("does not edit the 20260517230000 migration", () => {
    const original = readFileSync(ORIGINAL_URL);
    expect(original.toString("utf8")).toContain(ORIGINAL_OUTCOME_CHECK);
    expect(original.toString("utf8")).not.toContain("decline");
    expect(createHash("sha256").update(original).digest("hex")).toBe(ORIGINAL_SHA256);
    const diff = execFileSync("git", ["diff", "--no-ext-diff", "origin/main", "--", ORIGINAL_REL], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      encoding: "utf8",
    });
    expect(diff).toBe("");
  });
});
