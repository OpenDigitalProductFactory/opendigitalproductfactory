import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildGrammarSnapshot, serializeSnapshot } from "./grammar-negation";
import { checkGrammarConsistency } from "./grammar-consistency-check";

// BI-EAD441E0 slice S2 — THE CI STRUCTURAL GUARD.
//
// This test runs in the required Unit Tests job on every PR and every install's
// CI, so it ships to the fleet through the normal self-upgrade path and blocks a
// stance-negating grammar change pre-merge. Two failure modes, two remedies:
//   1. A grammar change NEGATES a kernel stance -> FAIL, fix the stance (or the change).
//   2. A benign grammar change left the baseline stale -> FAIL, re-freeze the
//      baseline with `pnpm --filter web exec tsx scripts/update-lifecycle-grammar-snapshot.ts`
//      (a deliberate, reviewed step — structural evolution is a first-class concern).

const BASELINE_PATH = join(__dirname, "lifecycle-grammar-snapshot.json");

function readBaseline(): string {
  try {
    return readFileSync(BASELINE_PATH, "utf8");
  } catch {
    throw new Error(
      `lifecycle-grammar-snapshot.json is missing at ${BASELINE_PATH}. ` +
        "Freeze it: pnpm --filter web exec tsx scripts/update-lifecycle-grammar-snapshot.ts",
    );
  }
}

describe("lifecycle grammar ↔ stance consistency guard (BI-EAD441E0)", () => {
  it("no grammar change negates a kernel stance (BLOCKS a stance-negating change)", () => {
    const result = checkGrammarConsistency(readBaseline());
    // A negating finding means a stage/state a standing stance depends on was
    // removed or renamed. This is the guard's hard stop.
    expect(
      result.negating,
      result.negating.length
        ? `Grammar change NEGATES a governing stance — route through governance, do not silently apply:\n` +
            result.negating.map((f) => `  - ${f.slug}: ${f.detail}`).join("\n")
        : "",
    ).toEqual([]);
  });

  it("the committed baseline is in sync with the live grammars (re-freeze on any structural change)", () => {
    const result = checkGrammarConsistency(readBaseline());
    expect(
      result.inSync,
      result.inSync
        ? ""
        : "The lifecycle grammars changed but the committed snapshot baseline was not re-frozen. " +
          "After confirming the first test passed (no stance negated), regenerate it:\n" +
          "  pnpm --filter web exec tsx scripts/update-lifecycle-grammar-snapshot.ts",
    ).toBe(true);
  });

  it("fails loud when it cannot evaluate — a corrupt/empty baseline is not a silent pass", () => {
    // Self-verifying discipline: a baseline that does not parse must throw, never
    // resolve to "no findings" (which would look like a clean pass).
    expect(() => checkGrammarConsistency("not json")).toThrow();
  });

  it("the frozen baseline round-trips the live grammars exactly", () => {
    // Guards against a hand-edited or stale baseline that happens to parse.
    expect(readBaseline()).toBe(serializeSnapshot(buildGrammarSnapshot()));
  });
});
