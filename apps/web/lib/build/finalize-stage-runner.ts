// apps/web/lib/build/finalize-stage-runner.ts
//
// BI-A0521CB0 — the finalize sequence for a Build Studio build entering review:
//   capture -> gauntlet -> (record gate decisions, re-run; bounded) ->
//   scoped tests recorded as evidence -> failure analysis citing that evidence.
// Every stop is a named status recorded on the build, never a silent pass.

import type { FailureVerificationEvidence } from "@/lib/change-review/failure-analysis";
import type { SandboxTestResult } from "./coding-agent";
import { authorFailureAnalysis, authorGateDecisions, trailerKeysForFailedGuards } from "./finalize-stage";
import type { GauntletRun } from "./sandbox/run-and-record-gauntlet";

/** Decision rounds after the first gauntlet run. */
export const FINALIZE_DECISION_ROUNDS = 2;

export type FinalizeDeps = {
  capture: () => Promise<{ diffPatch: string; changedFiles: string[] }>;
  runGauntlet: (diffPatch: string) => Promise<GauntletRun>;
  llm: (prompt: string) => Promise<string>;
  commitDecisions: (lines: string[]) => Promise<void>;
  runScopedTests: (changedFiles: string[]) => Promise<SandboxTestResult>;
  recordTests: (input: { binding: { sha: string; headTreeHash: string; diffDigest: string }; changedFiles: string[]; result: SandboxTestResult }) => Promise<string | null>;
  workroom: () => Promise<{ id: string; capsuleId: string } | null>;
  resolveEvidence: (ids: readonly string[], workroomId: string) => Promise<FailureVerificationEvidence[]>;
  designReference: () => Promise<string>;
  saveFailureAnalysis: (failureAnalysis: unknown) => Promise<void>;
  log: (summary: string) => void;
};

export type FinalizeOutcome =
  | { status: "ready"; evidenceIds: string[] }
  | { status: "gauntlet-not-run"; reason: string }
  | { status: "gauntlet-failed"; failedGuards: string[] }
  | { status: "decisions-missing"; missing: string[] }
  | { status: "decisions-exhausted"; failedGuards: string[] }
  | { status: "unbound" }
  | { status: "tests-failed" }
  | { status: "evidence-unresolvable"; resolved: number }
  | { status: "analysis-invalid"; reasons: string[] };

export async function runBuildStudioFinalize(buildId: string, deps: FinalizeDeps): Promise<FinalizeOutcome> {
  let captured = await deps.capture();
  let gauntlet = await deps.runGauntlet(captured.diffPatch);
  let rerunForFlake = false;
  for (let round = 0; ; round++) {
    if (!gauntlet.ran) return done(deps, buildId, { status: "gauntlet-not-run", reason: gauntlet.reason });
    if (gauntlet.passed) break;
    const keys = trailerKeysForFailedGuards(gauntlet.failedGuards);
    if (!keys && !rerunForFlake) {
      // A real guard failure is deterministic and fails again on the same tree;
      // one re-run separates it from an environmental flake (FB-D671B016 lost
      // four finalizes to a git fixture in Janitor Tests that passes on re-run).
      // Both runs are recorded as evidence, and only the passing one is cited.
      rerunForFlake = true;
      deps.log(`Guard gauntlet failed on ${gauntlet.failedGuards.join(", ")}; re-running once to separate a flake from a real failure.`);
      gauntlet = await deps.runGauntlet(captured.diffPatch);
      continue;
    }
    if (!keys) return done(deps, buildId, { status: "gauntlet-failed", failedGuards: gauntlet.failedGuards });
    if (round >= FINALIZE_DECISION_ROUNDS) return done(deps, buildId, { status: "decisions-exhausted", failedGuards: gauntlet.failedGuards });
    const decisions = await authorGateDecisions({
      llm: deps.llm, keys, guardOutput: gauntlet.output, diffSummary: captured.changedFiles.join("\n"),
    });
    if (decisions.kind !== "ok") return done(deps, buildId, { status: "decisions-missing", missing: decisions.missing });
    await deps.commitDecisions(decisions.lines);
    deps.log(`Recorded gate decisions (${keys.join(", ")}); re-running the guard gauntlet.`);
    captured = await deps.capture();
    gauntlet = await deps.runGauntlet(captured.diffPatch);
  }
  if (!gauntlet.binding || !gauntlet.recordId) return done(deps, buildId, { status: "unbound" });

  const tests = await deps.runScopedTests(captured.changedFiles);
  const testsRecordId = await deps.recordTests({ binding: gauntlet.binding, changedFiles: captured.changedFiles, result: tests });
  if (!tests.passed || !tests.typeCheckPassed || !testsRecordId) return done(deps, buildId, { status: "tests-failed" });

  const room = await deps.workroom();
  const evidenceIds = [gauntlet.recordId, testsRecordId];
  const evidence = room ? await deps.resolveEvidence(evidenceIds, room.id) : [];
  if (!room || evidence.length !== evidenceIds.length) {
    return done(deps, buildId, { status: "evidence-unresolvable", resolved: evidence.length });
  }

  const analysis = await authorFailureAnalysis({
    llm: deps.llm,
    identity: { capsuleId: room.capsuleId, headTreeHash: gauntlet.binding.headTreeHash, diffDigest: gauntlet.binding.diffDigest },
    designReference: await deps.designReference(),
    evidence,
    diffSummary: captured.changedFiles.join("\n"),
  });
  if (analysis.kind !== "ok") return done(deps, buildId, { status: "analysis-invalid", reasons: analysis.reasons });
  await deps.saveFailureAnalysis(analysis.failureAnalysis);
  return done(deps, buildId, { status: "ready", evidenceIds });
}

function done(deps: FinalizeDeps, buildId: string, outcome: FinalizeOutcome): FinalizeOutcome {
  const detail = "failedGuards" in outcome ? `: ${outcome.failedGuards.join(", ")}`
    : "missing" in outcome ? `: missing ${outcome.missing.join(", ")}`
    : "reasons" in outcome ? `: ${outcome.reasons.slice(0, 3).join(", ")}`
    : "reason" in outcome ? `: ${outcome.reason}`
    : "";
  deps.log(`Finalize ${buildId}: ${outcome.status}${detail}`);
  return outcome;
}
