// Contract tests for the bet → profession routing map (BI-9900B365).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { BET_PROFESSIONS, professionsForBet } from "./bet-professions";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const REGISTRY = JSON.parse(
  readFileSync(join(REPO_ROOT, "docs/professions/registry.json"), "utf8"),
) as { families: Array<{ professionKey: string }> };

const REGISTRY_KEYS = new Set(REGISTRY.families.map((family) => family.professionKey));

describe("bet-professions map", () => {
  it("covers each bet exactly once with well-formed keys", () => {
    const betKeys = BET_PROFESSIONS.map((assignment) => assignment.betKey);
    expect(new Set(betKeys).size).toBe(betKeys.length);
    for (const key of betKeys) expect(key).toMatch(/^BET-\d+$/);
  });

  it("every professionKey exists in docs/professions/registry.json", () => {
    for (const assignment of BET_PROFESSIONS) {
      expect(assignment.professionKeys.length).toBeGreaterThan(0);
      for (const key of assignment.professionKeys) {
        expect(REGISTRY_KEYS.has(key), `${assignment.betKey}: unknown profession ${key}`).toBe(true);
      }
    }
  });

  it("professionsForBet resolves primary-first and empty for unknown bets", () => {
    expect(professionsForBet("BET-1")).toEqual(["data-architect"]);
    expect(professionsForBet("BET-99")).toEqual([]);
  });
});
