// apps/web/lib/build/verification-repair.ts
//
// BI-99B06AD1 (P0.1, "the biggest architectural gap") — build/codegen
// verification → bounded fix loop.
//
// Why this exists:
//   When a build's own verification (typecheck/tests on its CHANGED files)
//   fails, the orchestrator today just stalls at the build→review gate and
//   waits for a human — there is no cross-step repair. The only retry that
//   exists is inside a single specialist's agentic loop. So a one-line type
//   error or a failing assertion strands the build indefinitely. (Family 1 of
//   docs/superpowers/specs/2026-06-19-build-studio-reliability-analysis.md.)
//
//   This module is the bounded repair loop: on a scoped verification failure,
//   dispatch a repair coding turn scoped to the failing files + the real error
//   text, re-verify, and repeat up to N rounds before falling through to the
//   existing gate (which stalls/escalates as before). It is dependency-injected
//   — the orchestrator supplies the real dispatch + re-verify — so the loop and
//   its prompt-building are fully unit-tested without a sandbox or an LLM.

import type { BuildFailureAxis } from "./progress-visibility-types";

/** Default bound — small on purpose; a build that can't be fixed in a couple of
 *  scoped turns wants a human, not an infinite churn. Operator-tunable. */
export const VERIFICATION_REPAIR_MAX_ROUNDS =
  Number(process.env.BUILD_VERIFICATION_REPAIR_MAX_ROUNDS) || 2;

export type RepairVerdict = {
  typecheckPassed: boolean | null;
  testsFailed: number | null;
  failureAxis: BuildFailureAxis | null;
  /** Raw typecheck+test output — the seed for the next repair prompt. */
  output: string;
};

/** Pure: does the scoped verdict warrant a repair turn? (A null typecheck verdict
 *  means "only out-of-scope noise" — not this build's problem, so no repair.) */
export function verificationNeedsRepair(v: {
  typecheckPassed: boolean | null;
  testsFailed: number | null;
}): boolean {
  return v.typecheckPassed === false || (v.testsFailed ?? 0) > 0;
}

/** Pure: the failing source files = repo paths named in the error text that are
 *  within the build's changed surface; falls back to the changed files when the
 *  error names none (so the repair turn still has a scope). Capped to keep the
 *  prompt bounded. */
export function selectFailingFiles(errorOutput: string, changedFiles: string[]): string[] {
  const mentioned = [
    ...(errorOutput ?? "").matchAll(/\b(?:apps|packages)\/[A-Za-z0-9_./()-]+\.[A-Za-z0-9]+/g),
  ].map((m) => m[0].replace(/[),.;:]+$/, ""));
  const inScope = mentioned.filter((f) =>
    changedFiles.some((cf) => cf === f || cf.endsWith(f) || f.endsWith(cf)),
  );
  const chosen = inScope.length > 0 ? inScope : changedFiles;
  return [...new Set(chosen)].slice(0, 12);
}

/** Pure: the scoped repair task prompt (failing files + the real error). */
export function buildRepairPrompt(args: {
  attempt: number;
  maxRounds: number;
  failureAxis: BuildFailureAxis | null;
  errorOutput: string;
  failingFiles: string[];
}): { title: string; implement: string; verify: string } {
  const kind = args.failureAxis === "typecheck-failure" ? "typecheck" : "test";
  const files = args.failingFiles.length ? args.failingFiles.join(", ") : "the changed files";
  return {
    title: `Repair ${kind} failures (round ${args.attempt}/${args.maxRounds})`,
    implement:
      `The build's own verification FAILED on its changed surface (${kind}). ` +
      `Fix ONLY the failing code in: ${files}.\n\n` +
      `Exact verification output:\n${(args.errorOutput ?? "").slice(0, 1800)}\n\n` +
      `Make the minimal change that resolves the failure. Do NOT refactor or ` +
      `touch unrelated code, and do NOT weaken, skip, or delete tests just to ` +
      `make them pass.`,
    verify: "Run `tsc --noEmit` and the tests for the changed files; all must pass.",
  };
}

export type RepairLoopResult = {
  rounds: number;
  repaired: boolean;
  final: RepairVerdict;
};

/**
 * Bounded verification → repair loop. Dependency-injected so it is fully
 * testable: `dispatchRepair` runs one scoped coding turn (returns true if it
 * completed), `reverify` re-runs typecheck/tests and returns the fresh verdict.
 * Stops the moment the verdict is clean or the round budget is spent; on an
 * incomplete dispatch it stops rather than re-verifying stale state. Never
 * throws on its own — dispatch/verify error handling is the caller's.
 */
export async function runVerificationRepairLoop(args: {
  initial: RepairVerdict;
  changedFiles: string[];
  maxRounds: number;
  dispatchRepair: (spec: {
    title: string;
    implement: string;
    verify: string;
    failingFiles: string[];
    attempt: number;
  }) => Promise<boolean>;
  reverify: () => Promise<RepairVerdict>;
  log?: (m: string) => void | Promise<void>;
}): Promise<RepairLoopResult> {
  const { initial, changedFiles, maxRounds, dispatchRepair, reverify, log } = args;
  let verdict = initial;
  let rounds = 0;

  while (verificationNeedsRepair(verdict) && rounds < maxRounds) {
    rounds += 1;
    const failingFiles = selectFailingFiles(verdict.output, changedFiles);
    const prompt = buildRepairPrompt({
      attempt: rounds,
      maxRounds,
      failureAxis: verdict.failureAxis,
      errorOutput: verdict.output,
      failingFiles,
    });
    await log?.(`verification-repair round ${rounds}/${maxRounds} on ${failingFiles.length} file(s)`);
    const completed = await dispatchRepair({ ...prompt, failingFiles, attempt: rounds });
    if (!completed) {
      await log?.(`verification-repair round ${rounds} dispatch did not complete — stopping`);
      break;
    }
    verdict = await reverify();
  }

  return { rounds, repaired: !verificationNeedsRepair(verdict), final: verdict };
}
