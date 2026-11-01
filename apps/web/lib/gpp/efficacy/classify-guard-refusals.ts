// BI-FEDD8F45 — classify each guard refusal from later records alone.
// Design: docs/superpowers/specs/2026-10-14-guard-outcome-efficacy-design.md §4.3.
//
// Pure. The table is deliberately conservative: when the records cannot
// separate a fixed defect from a moved base or a changed guard, the refusal is
// `unresolved`, never `caught` or `false-refusal`. A guard is credited with a
// catch only when the author's change moved and nothing else did.

import type { GuardResultKind, GuardVerdict, GuardRunOverride } from "./guard-outcome-run";

export const CLASSIFICATION_WINDOW_DAYS = 14;

export type GuardOutcome = "caught" | "overridden" | "false-refusal" | "unresolved";

export type GuardOutcomeReason =
  | "code-changed"
  | "guard-changed"
  | "baseline-raised"
  | "no-later-pass"
  | "dirty-tree"
  | "base-moved"
  | "ambiguous"
  | "flaky-pass"
  | (string & {}); // an override code

export type GuardRunForClassification = {
  runId: string;
  startedAt: Date;
  cloneKey: string;
  branch: string;
  baseSha: string | null;
  headSha: string;
  patchId: string | null;
  dirty: boolean;
  override: GuardRunOverride | null;
  guards: ReadonlyArray<{
    guardId: string;
    kind: GuardResultKind;
    guardDigest: string;
    baselineDigest: string | null;
    verdict: GuardVerdict;
  }>;
};

export type GuardRefusalClassification = {
  /** `${runId}:${guardId}` — one classification per refused result. */
  key: string;
  runId: string;
  guardId: string;
  cloneKey: string;
  branch: string;
  refusedAt: Date;
  outcome: GuardOutcome;
  reason: GuardOutcomeReason;
  decidingRunId: string | null;
};

type Observation = {
  run: GuardRunForClassification;
  guard: GuardRunForClassification["guards"][number];
};

function decide(refused: Observation, pass: Observation): { outcome: GuardOutcome; reason: GuardOutcomeReason } {
  if (refused.run.dirty || pass.run.dirty) return { outcome: "unresolved", reason: "dirty-tree" };
  if (refused.run.baseSha !== pass.run.baseSha) return { outcome: "unresolved", reason: "base-moved" };
  const guardChanged = refused.guard.guardDigest !== pass.guard.guardDigest;
  const codeChanged = refused.run.patchId !== pass.run.patchId;
  if (guardChanged) {
    return codeChanged ? { outcome: "unresolved", reason: "ambiguous" } : { outcome: "false-refusal", reason: "guard-changed" };
  }
  if (refused.guard.baselineDigest !== pass.guard.baselineDigest) return { outcome: "overridden", reason: "baseline-raised" };
  if (codeChanged) return { outcome: "caught", reason: "code-changed" };
  return { outcome: "unresolved", reason: "flaky-pass" };
}

/**
 * Classify every refused `guard`-kind result in `runs`. A refusal is left
 * unclassified (absent from the result) only while it has no deciding pass and
 * its window is still open.
 */
export function classifyGuardRefusals(
  runs: readonly GuardRunForClassification[],
  { now, windowDays = CLASSIFICATION_WINDOW_DAYS }: { now: Date; windowDays?: number },
): GuardRefusalClassification[] {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const series = new Map<string, Observation[]>();
  for (const run of runs) {
    for (const guard of run.guards) {
      if (guard.kind !== "guard") continue;
      const key = `${run.cloneKey}\0${run.branch}\0${guard.guardId}`;
      const list = series.get(key) ?? [];
      list.push({ run, guard });
      series.set(key, list);
    }
  }

  const classifications: GuardRefusalClassification[] = [];
  for (const observations of series.values()) {
    observations.sort(
      (a, b) => a.run.startedAt.getTime() - b.run.startedAt.getTime() || a.run.runId.localeCompare(b.run.runId),
    );
    observations.forEach((observation, index) => {
      if (observation.guard.verdict !== "refused") return;
      const refusedAt = observation.run.startedAt;
      const base = {
        key: `${observation.run.runId}:${observation.guard.guardId}`,
        runId: observation.run.runId,
        guardId: observation.guard.guardId,
        cloneKey: observation.run.cloneKey,
        branch: observation.run.branch,
        refusedAt,
      };
      if (observation.run.override) {
        classifications.push({ ...base, outcome: "overridden", reason: observation.run.override.code, decidingRunId: null });
        return;
      }
      const deadline = refusedAt.getTime() + windowMs;
      const pass = observations
        .slice(index + 1)
        .find((later) => later.guard.verdict === "passed" && later.run.startedAt.getTime() <= deadline);
      if (!pass) {
        if (now.getTime() >= deadline) {
          classifications.push({ ...base, outcome: "unresolved", reason: "no-later-pass", decidingRunId: null });
        }
        return;
      }
      classifications.push({ ...base, ...decide(observation, pass), decidingRunId: pass.run.runId });
    });
  }

  return classifications.sort(
    (a, b) => a.refusedAt.getTime() - b.refusedAt.getTime() || a.key.localeCompare(b.key),
  );
}
