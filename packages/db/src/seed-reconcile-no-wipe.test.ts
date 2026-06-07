import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// No-wipe invariant for the catalog/provider reconcile paths.
//
// On a portal update the seed + sync-provider-registry reconcile catalog metadata
// (provider names, cliEngine, supportedAuthMethods, pricing, …) into existing rows.
// That reconcile MUST be upsert/merge only — it must never delete operator-owned
// rows, or an update would wipe an operator's configured credentials / provider
// selections / platform config. This guards against a future change silently
// reintroducing a table reset (a real early-days incident).
//
// Targeted, not blanket: `modelProfile` rows ARE deletable (runtime-discovered
// calibration data), so only the operator-owned tables are protected here.

const RECONCILE_SOURCES = [
  join(__dirname, "seed.ts"),
  join(__dirname, "..", "scripts", "sync-provider-registry.ts"),
];

const PROTECTED_MODELS = ["modelProvider", "credentialEntry", "platformConfig"] as const;

describe("seed/sync reconcile no-wipe invariant", () => {
  for (const sourcePath of RECONCILE_SOURCES) {
    const source = readFileSync(sourcePath, "utf8");
    const label = sourcePath.split(/[\\/]/).slice(-1)[0];

    for (const model of PROTECTED_MODELS) {
      it(`${label} never calls delete/deleteMany on ${model}`, () => {
        // Matches prisma.<model>.delete( / .deleteMany( with any whitespace.
        const re = new RegExp(`\\.${model}\\s*\\.\\s*(delete|deleteMany)\\b`);
        const match = source.match(re);
        expect(
          match === null,
          match
            ? `${label} contains "${match[0]}" — the reconcile must be upsert/merge only; ` +
                `operator-owned ${model} rows must never be wiped on update.`
            : "",
        ).toBe(true);
      });
    }

    it(`${label} contains no raw TRUNCATE/DELETE on protected tables`, () => {
      const re = /(TRUNCATE|DELETE\s+FROM)\s+"?(ModelProvider|CredentialEntry|PlatformConfig)"?/i;
      expect(source.match(re)).toBeNull();
    });
  }
});
