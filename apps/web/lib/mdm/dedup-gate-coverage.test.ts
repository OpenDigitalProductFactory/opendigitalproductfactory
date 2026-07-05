import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GATED_CREATE_PATHS } from "./dedup-gate";

/**
 * Coverage guard (spec §5.1 / §4): the explicit-guarded-create decision traded
 * away interception's cannot-bypass property for this test. Every write path
 * registered in GATED_CREATE_PATHS must still reference the dedup gate; a
 * refactor that drops the call (or moves the file) fails here, not in prod.
 */

// apps/web/lib/mdm → repo root is four levels up.
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

const GATE_TOKENS = [
  "checkCustomerAccountDuplicates",
  "checkCustomerContactDuplicates",
  "checkCustomerSiteDuplicates",
  "resolveDedupDecision",
  // Identity-flow paths (sign-up, social auth, order-derived contacts) don't
  // run the interactive gate but must keep the normalized columns fresh:
  "customerAccountNormalizedColumns",
  "customerContactNormalizedColumns",
  "customerSiteNormalizedColumns",
  // Tool-layer handlers integrate via the action's dedup contract:
  "DedupResolution",
  "duplicates-found",
];

describe("dedup-gate coverage guard", () => {
  for (const [domain, paths] of Object.entries(GATED_CREATE_PATHS)) {
    for (const registered of paths) {
      const [relPath] = registered.split("#");
      it(`${domain}: ${registered} calls the gate`, () => {
        const source = readFileSync(join(REPO_ROOT, relPath!), "utf8");
        const referencesGate = GATE_TOKENS.some((token) => source.includes(token));
        expect(
          referencesGate,
          `${relPath} is registered in GATED_CREATE_PATHS but no longer references the dedup gate`,
        ).toBe(true);
      });
    }
  }
});
