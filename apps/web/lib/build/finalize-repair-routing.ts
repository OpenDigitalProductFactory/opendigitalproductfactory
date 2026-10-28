// apps/web/lib/build/finalize-repair-routing.ts
//
// BI-33B54E4B: the finalize stops a coding agent can fix, as the hand-back the
// shared bounded repair takes. A stop that reached no verdict is never handed
// back: no change to the code can fix a test runner that did not run.

import type { FinalizeOutcome } from "./finalize-stage-runner";
import type { GauntletFailure } from "./gauntlet-repair";

export function repairFailureForFinalize(outcome: FinalizeOutcome): GauntletFailure | null {
  if (outcome.status !== "tests-failed") return null;
  const findings = outcome.failure === "typecheck"
    ? [{ severity: "important", description: "Typecheck fails in the changed files; see the recorded typecheck output." }]
    : outcome.failingTests.length > 0
      ? outcome.failingTests.map((name) => ({ severity: "important", description: `Failing test: ${name}` }))
      : [{ severity: "important", description: "Scoped tests failed; the failing tests are in the recorded test output." }];
  return {
    treeSha: outcome.treeSha,
    recordId: outcome.recordId,
    failedGuards: [outcome.failure === "typecheck" ? "Typecheck" : "Scoped tests"],
    source: "tests",
    findings,
  };
}
