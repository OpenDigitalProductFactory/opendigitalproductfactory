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

import { spawnSync } from "node:child_process";

import {
  POLICY_GUARD_PROFILES,
  isPolicyGuardSelfTest,
  resolvePolicyGuardInvocation,
  runPolicyProfile,
} from "./ci-policy-guards.mjs";
import { GUARD_RUNTIME_ENVIRONMENT_ERROR_NAME } from "./load-pinned-guard-typescript.mjs";

export const PREFLIGHT_SKIP_ENV = "DPF_SKIP_PREGATE_PREFLIGHT_REASON";

// Pull-request-profile gates that are commit-range-driven and therefore give a
// truthful answer on a host worktree without PR context. Everything else in
// that profile is excluded on purpose:
//   - seed-fit-gate reads the PR body, which does not exist before push;
//   - docs-impact-gate / data-impact-gate / spec-plan-doc-gate carry heavier
//     self-test dependencies and are candidates for a later slice once their
//     host-side behavior is proven;
//   - decision-baseline MERGES origin/main into the branch — a tree mutation
//     the preflight must never perform.
export const LOCAL_SAFE_PR_GUARD_IDS = Object.freeze([
  "ux-fit-gate",
  "design-grounding-gate",
]);

// Exit-output signatures that mean "this host cannot run the guard", not
// "the tree violates the guard". Kept narrow: each entry is a message Node or
// the guard runtime itself emits for a missing execution substrate.
export const ENVIRONMENT_FAILURE_RE =
  /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find module|node_modules missing|tsx(?::|\W+is) (?:command )?not (?:recognized|found)/i;

export function isEnvironmentFailureOutput(output) {
  const text = String(output ?? "");
  return text.includes(`${GUARD_RUNTIME_ENVIRONMENT_ERROR_NAME}:`)
    || ENVIRONMENT_FAILURE_RE.test(text);
}

function stripSelfTests(entries) {
  return entries
    .map((entry) => ({
      ...entry,
      commands: entry.commands.filter((command) => !isPolicyGuardSelfTest(command)),
    }))
    .filter((entry) => entry.commands.length > 0);
}

export function buildPreflightPlan({ profiles = POLICY_GUARD_PROFILES } = {}) {
  const source = stripSelfTests([
    ...(profiles.source ?? []),
    ...(profiles.workspace ?? []),
  ]);
  const trailer = stripSelfTests(
    profiles["pull-request"].filter((entry) =>
      LOCAL_SAFE_PR_GUARD_IDS.includes(entry.id),
    ),
  );
  return [...source, ...trailer];
}

function defaultExecute(command, args) {
  const invocation = resolvePolicyGuardInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    shell: false,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`;
  if (result.status !== 0) process.stderr.write(output);
  return { exitCode: result.status ?? 1, output };
}

/**
 * Runs the preflight plan. Unlike runPolicyProfile, the executor returns
 * `{ exitCode, output }` so a non-zero exit whose output matches
 * ENVIRONMENT_FAILURE_RE can be reclassified as `skipped_environment` instead
 * of `failed`. `ok` is false only for genuine guard failures.
 */
export async function runPreflight({
  plan = buildPreflightPlan(),
  execute = defaultExecute,
  logger = () => {},
  now = () => Date.now(),
  env = process.env,
} = {}) {
  const skipReason = env[PREFLIGHT_SKIP_ENV];
  if (skipReason) {
    return { ok: true, skipped: true, skipReason, entries: [] };
  }

  const wrapped = new Map();
  const result = await runPolicyProfile({
    entries: plan,
    execute: (command, args) => {
      const { exitCode, output } = execute(command, args);
      if (exitCode !== 0) {
        wrapped.set(
          [command, ...args].join(" "),
          isEnvironmentFailureOutput(output) ? "environment" : "violation",
        );
      }
      return exitCode;
    },
    logger,
    now,
  });

  const entries = result.entries.map((entry) => {
    if (entry.status !== "failed") return entry;
    const kind = wrapped.get(entry.failedCommand);
    return kind === "environment"
      ? { ...entry, status: "skipped_environment" }
      : entry;
  });

  return {
    ok: entries.every((entry) => entry.status !== "failed"),
    skipped: false,
    skipReason: null,
    entries,
  };
}
