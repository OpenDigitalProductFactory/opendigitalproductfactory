// scripts/lib/pregate-preflight.mjs — host-side guard parity preflight
// (BI-D35433FB, EP-0DFF753B).
//
// THE PROBLEM: the local pregate runs the full test suite, typecheck, and a
// production build inside the leased local-integration-ci sandbox (30–60+ min),
// but never runs the deterministic CI policy guards — module size, prose/style
// ratchets, derived-artifact staleness, commit-trailer attestations. A 52h CI
// failure taxonomy (2026-07-27 → 07-29) counted ~90 failed jobs in exactly that
// class: author-fixable in seconds, discoverable only by pushing, each one
// costing a full CI round trip and usually a lease-holding pregate first.
//
// THE FIX: run those same guard scripts host-native BEFORE lease admission, so
// a doomed gate never occupies a contended sandbox slot. The preflight reuses
// POLICY_GUARD_PROFILES verbatim — same scripts CI runs — with two deliberate
// reductions:
//
//   1. Guard SELF-TESTS (`node --test …`) are stripped. They prove the guard's
//      own logic and belong to CI's Policy Guards jobs; the preflight only
//      needs the tree checked, and several self-tests require the isolated
//      @dpf/repo-guard-runtime install that a source-only worktree lacks.
//   2. Only commit-range-driven pull-request gates are included (UX-Fit,
//      Design Grounding). Gates that read the PR body (Seed-Fit) or mutate the
//      tree (Decision Baseline merges origin/main) cannot run honestly on a
//      host worktree and stay CI-only.
//
// DEGRADATION CONTRACT: a guard that exits non-zero because the ENVIRONMENT
// cannot run it (missing module, missing isolated pnpm graph) is reported as
// `skipped_environment` with the guard's own remedy line — never a hard fail
// and never silently green. CI remains the enforcer; the preflight is an
// honest early warning, so a false local failure would erode trust faster
// than a missed one.

import { stripVTControlCharacters } from "node:util";
import { createObservedProcessRunner } from "./local-ci-process-observer.mjs";
import { guardGitEnv } from "./git-hook-env.mjs";
import { guardShellEnv } from "./guard-bash.mjs";

import {
  POLICY_GUARD_PROFILES,
  isPolicyGuardSelfTest,
  resolvePolicyGuardInvocation,
  runPolicyProfile,
} from "./ci-policy-guards.mjs";
import { GUARD_RUNTIME_ENVIRONMENT_ERROR_NAME } from "./load-pinned-guard-typescript.mjs";
import { RUNNER_FAILURE_EXIT_CODE } from "../check-guards.mjs";

export const PREFLIGHT_SKIP_ENV = "DPF_SKIP_PREGATE_PREFLIGHT_REASON";

// Pull-request-profile gates that are commit-range-driven and therefore give a
// truthful answer on a host worktree without PR context.
//
// docs-impact / data-impact / spec-plan-doc were the "later slice once their
// host-side behavior is proven" this list originally deferred. Proven on
// 2026-08-23: the self-test dependencies that motivated the deferral are
// removed by stripSelfTests() before anything runs, and what remains is four
// commit-range scans totalling ~2.1s on a ~95s preflight. Leaving them out cost
// a full CI round trip on #4558, where Docs Impact failed in CI on an edge the
// preflight had just declared clean.
//
// seed-fit-gate joined this list on 2026-09-11 (BI-4F1E9249). Its exclusion
// reason — "reads the PR body, which does not exist before push" — was removed
// rather than waived: the gate now reads `git log <base>..HEAD` for its
// decision, as its four sibling decision gates already did. It cost a full CI
// round trip on #5291, where a kernel principle was pushed without a seed-fit
// decision and the fix needed an amended commit plus a fresh local-CI gate.
//
// ONE gate stays excluded, and that reason does NOT expire:
//   - decision-baseline MERGES origin/main into the branch — a tree mutation
//     the preflight must never perform.
export const LOCAL_SAFE_PR_GUARD_IDS = Object.freeze([
  "ux-fit-gate",
  "design-grounding-gate",
  "docs-impact-gate",
  "data-impact-gate",
  "convergence-impact-gate",
  "spec-plan-doc-gate",
  "seed-fit-gate",
  // Reads the commit range host-side; PR title/body are CI-only extras
  // (BI-5D412E3C), so a local run still answers for the commit messages.
  "hidden-unicode-commit-text-guard",
]);

// Recognize runtime diagnostic lines, not words quoted by a completed guard.
// Static import guards explain ERR_MODULE_NOT_FOUND while reporting genuine
// violations; bare error-code/message matches would waive those failures.
export const ENVIRONMENT_FAILURE_RE = new RegExp([
  /^Error(?: \[ERR_MODULE_NOT_FOUND\])?: Cannot find (?:module|package)(?: |$)/.source,
  `^${GUARD_RUNTIME_ENVIRONMENT_ERROR_NAME}:`,
  /^(?:[ \t\u{2009}]*WARN[ \t\u{2009}]+)?Local package\.json exists, but node_modules missing(?:, did you mean to install\?)?\r?$/u.source,
  /^(?:(?:[^ \r\n]*[/\\])?(?:ba|da|z)?sh: (?:line \d+: |\d+: )?)?tsx: (?:command )?not found\r?$/.source,
  /^'tsx' is not recognized as an internal or external command,?\r?$/.source,
].join("|"), "mu");

export function isEnvironmentFailureOutput(output) {
  return ENVIRONMENT_FAILURE_RE.test(stripVTControlCharacters(String(output ?? "")));
}

// A guard command is a RUNNER failure — "the host could not run the guard", NOT
// a deterministic tree violation (BI-AA2EE621) — when the host refused or killed
// its spawn (`error`, or a signal/`taskkill /T` that leaves spawnSync
// `status: null`), or when the Repo Guard Loop runner itself exits with its
// reserved runner-failure code. Keyed on the EXIT CODE and spawn signals, never
// on guard OUTPUT text: a real violation (exit 1) whose output happens to
// mention a killed sub-guard must never be downgraded to a non-blocking warning.
// `check-guards.mjs` emits RUNNER_FAILURE_EXIT_CODE only when it found zero
// violations, so honouring that code (for the guard-loop runner alone) cannot
// mask a violation; every guard's own contract stays exit 1 = violation.
export function isRunnerFailureResult({ args = [], status, error } = {}) {
  if (error) return true;
  if (status === null || status === undefined) return true;
  const isGuardLoopRunner = args.some((a) => String(a).includes("check-guards.mjs"));
  return isGuardLoopRunner && status === RUNNER_FAILURE_EXIT_CODE;
}

function stripSelfTests(entries) {
  return entries
    .map((entry) => ({
      ...entry,
      commands: entry.commands.filter((command) => !isPolicyGuardSelfTest(command)),
    }))
    .filter((entry) => entry.commands.length > 0);
}

/**
 * BI-8CDA7F95: does this guard apply to the classified change scope?
 *
 * The scope comes from scripts/ci-change-scope.mjs — the same classifier
 * ci.yml branches on — so host and cloud agree on what "docs-only" means. A
 * guard is skipped ONLY when it DECLARES `inputs` that a docs-only diff cannot
 * touch (`inputs: ["code"]`, see ci-policy-guards.mjs). No declaration, no
 * classification, or any non-docs change: the guard runs. Never skip on a
 * guess — a wrong skip is a false green (BI-7B249AFE).
 */
export function guardAppliesToScope(entry, changeScope) {
  if (!changeScope || changeScope.docsOnly !== true) return true;
  const inputs = Array.isArray(entry?.inputs) ? entry.inputs : null;
  if (!inputs) return true;
  return inputs.includes("docs");
}

/**
 * The preflight plan for a change scope: the entries to run, and the entries
 * left out because their declared inputs cannot be touched by this diff.
 */
export function planPreflight({ profiles = POLICY_GUARD_PROFILES, changeScope = null } = {}) {
  const source = stripSelfTests([
    ...(profiles.source ?? []),
    ...(profiles.workspace ?? []),
  ]);
  const trailer = stripSelfTests(
    profiles["pull-request"].filter((entry) =>
      LOCAL_SAFE_PR_GUARD_IDS.includes(entry.id),
    ),
  );
  const all = [...source, ...trailer];
  const entries = all.filter((entry) => guardAppliesToScope(entry, changeScope));
  const skippedByScope = all.filter((entry) => !guardAppliesToScope(entry, changeScope));
  return { entries, skippedByScope, changeScope: changeScope ?? null };
}

export function buildPreflightPlan({ profiles = POLICY_GUARD_PROFILES, changeScope = null } = {}) {
  return planPreflight({ profiles, changeScope }).entries;
}

/**
 * Builds the executor that runs one guard command. The environment handed to
 * every guard is scrubbed of git's repository-locating variables
 * (BI-062F5687): under `git push` from a linked worktree the hook inherits
 * GIT_DIR, and a guard that builds a temp git fixture would otherwise commit
 * to the REAL repository — which is how a 15,511-file deletion landed on a
 * pushing branch. Guards resolve their repository from cwd, never from the
 * hook's environment. Git's automatic maintenance is off for the same
 * children, so a fixture's commits never race a background repack
 * (BI-E0FEB8E9).
 */
// Full source guard loops have exceeded ten minutes on measured developer
// hosts. Keep a finite budget without turning normal execution into a timeout.
export const HOST_GUARD_MAX_DURATION_MS = 30 * 60_000;

export function createDefaultExecute(env = process.env, { maxDurationMs = HOST_GUARD_MAX_DURATION_MS,
  signal, progress = () => {}, terminationGraceMs = 10_000, closeGraceMs = 10_000 } = {}) {
  if (!Number.isInteger(maxDurationMs) || maxDurationMs <= 0) throw new TypeError("host guard duration must be a positive finite budget");
  let guardEnv;
  return async function defaultExecute(command, args, observation = {}) {
    try {
      guardEnv ??= guardShellEnv(guardGitEnv(env));
    } catch (error) {
      return { exitCode: 1, output: `${error.name}: ${error.message}`, runnerFailure: false };
    }
    const invocation = resolvePolicyGuardInvocation(command, args, { env: guardEnv });
    const run = createObservedProcessRunner({ maxDurationMs, terminationGraceMs, closeGraceMs,
      sampleHost: () => null, stdout: { write() {} }, stderr: { write() {} }, onProgress: progress });
    progress({ ...observation, phase: "started" });
    const result = await run({ command: invocation.command, args: invocation.args,
      cwd: process.cwd(), env: guardEnv, shell: false, signal, observation });
    const output = `${result.outputTail ?? ""}${result.error?.message ?? ""}`;
    const outcome = result.cancelled ? "cancelled" : result.deadlineExceeded ? "timed_out"
      : result.closeTimedOut || result.error || result.status === null ? "runner_failed" : null;
    const exitCode = outcome ? 88 : result.status ?? 1;
    if (exitCode !== 0) process.stderr.write(output);
    progress({ ...observation, phase: "completed", exitCode, outcome, deadlineAt: result.deadlineAt });
    // A guard command the host refused to launch, killed by a signal, or the
    // guard-loop runner's reserved runner-failure exit code — keyed on exit code,
    // never on output text — so runPreflight never mislabels an evicted spawn as
    // deterministic, nor downgrades a real violation that merely mentions one.
    const runnerFailure = isRunnerFailureResult({ args, status: result.status, error: result.error });
    return { exitCode, output, runnerFailure: Boolean(outcome) || runnerFailure, outcome };
  };
}

/**
 * Runs the preflight plan. Unlike runPolicyProfile, the executor returns
 * `{ exitCode, output, runnerFailure }` so a non-zero exit can be reclassified:
 * a recognized runtime diagnostic becomes `skipped_environment`, and a
 * spawn the host refused or killed (the `runnerFailure` flag, keyed on exit code
 * and spawn signals) becomes `runner_failed` (BI-AA2EE621). Both mean "this host
 * could not run the
 * guard", so — like the environment skip this file already documents — they
 * WARN and let CI/the sandbox enforce rather than mislabelling an evicted spawn
 * as a deterministic violation. `ok` is false only for genuine guard failures.
 */
export async function runPreflight({
  plan = buildPreflightPlan(),
  logger = () => {},
  now = () => Date.now(),
  env = process.env,
  signal,
  execute = createDefaultExecute(env, { signal }),
} = {}) {
  const skipReason = env[PREFLIGHT_SKIP_ENV];
  if (skipReason) {
    return { ok: true, skipped: true, skipReason, entries: [] };
  }

  const wrapped = new Map();
  const result = await runPolicyProfile({
    entries: plan,
    execute: async (command, args, observation) => {
      const { exitCode, output, runnerFailure, outcome } = await execute(command, args, observation);
      if (exitCode !== 0) {
        // Precedence: a stable missing-runtime signal (environment) wins over a
        // transient host-pressure signal (runner) wins over a real violation.
        // `runnerFailure` is keyed on exit code / spawn signals, not output
        // text, so a real violation is never downgraded to a warning.
        const kind = outcome || (isEnvironmentFailureOutput(output)
          ? "environment"
          : runnerFailure
            ? "runner"
            : "violation");
        wrapped.set([command, ...args].join(" "), kind);
      }
      return exitCode;
    },
    logger,
    now,
    shouldStop: () => Boolean(signal?.aborted),
  });

  const entries = result.entries.map((entry) => {
    if (entry.status !== "failed") return entry;
    const kind = wrapped.get(entry.failedCommand);
    if (kind === "environment") return { ...entry, status: "skipped_environment" };
    if (kind === "runner" || kind === "runner_failed") return { ...entry, status: "runner_failed" };
    if (kind === "timed_out" || kind === "cancelled") return { ...entry, status: kind };
    return entry;
  });

  return {
    ok: entries.every((entry) => !["failed", "timed_out", "cancelled"].includes(entry.status)),
    skipped: false,
    skipReason: null,
    entries,
  };
}
