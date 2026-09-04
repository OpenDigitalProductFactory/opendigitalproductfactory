// Affected-test selection for the local-CI vitest stage (BI-2227C37C).
//
// AGENTS.md §4: "Fast local checks (typecheck, lint, affected tests — no
// Docker) gate the push; the full build is the cloud merge-queue safety net."
//
// The stage was doing the opposite. It ran `vitest run` over all 3017 apps/web
// test files on every push — its own stage name is `exhaustive-vitest` — while
// holding the single local-integration-ci slot, and the cloud shards the same
// suite four ways. Measured 2026-08-29: the suite grew 2462 -> 3414 test files
// in five weeks (+39%), so suite growth converted one-for-one into gate time
// and, at a fixed capacity of one, into a p90 queue wait of 1053s.
//
// Selection is vitest's own `--changed <ref>`, which walks its module graph, so
// a changed library still pulls in its dependents' tests. It is not a
// hand-maintained path map that can silently rot.
//
// TWO PROPERTIES THIS MUST KEEP:
//
//   1. Fail safe. Anything unknown — no base ref, an unreadable diff, a changed
//      file whose blast radius the module graph cannot see — falls back to the
//      exhaustive run. Selection narrows only when it is certain it may.
//   2. The cloud stays exhaustive. This narrows the LOCAL tier only. The
//      merge-queue safety net still runs every test, sharded, off the critical
//      path, which is what makes local selection safe rather than a gamble.

/**
 * Files whose blast radius vitest's module graph cannot see.
 *
 * A test runner config, a lockfile, a tsconfig or the Prisma schema can change
 * the behaviour of tests that never import them, so any of these forces the
 * exhaustive run. This list is deliberately generous: a wrong narrow is a false
 * green, and a wrong widen only costs time.
 */
export const EXHAUSTIVE_TRIGGER_PATTERNS = Object.freeze([
  /(^|\/)vitest\.(config|workspace)\.[cm]?[jt]s$/,
  /(^|\/)tsconfig[^/]*\.json$/,
  /(^|\/)package\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)pnpm-workspace\.yaml$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)next\.config\.[cm]?[jt]s$/,
  /(^|\/)schema\.prisma$/,
  /(^|\/)prisma\/migrations\//,
  /(^|\/)test-setup\.[cm]?[jt]sx?$/,
  /(^|\/)vitest\.setup\.[cm]?[jt]sx?$/,
  /(^|\/)apps\/web\/test\//,
  /(^|\/)\.env(\.|$)/,
]);

/** Opt out of selection entirely, recorded rather than silent. */
export const EXHAUSTIVE_ENV = "DPF_LOCAL_CI_VITEST_EXHAUSTIVE";

export function exhaustiveTrigger(changedFiles) {
  for (const file of changedFiles) {
    const normalized = String(file ?? "").replace(/\\/g, "/").trim();
    if (!normalized) continue;
    for (const pattern of EXHAUSTIVE_TRIGGER_PATTERNS) {
      if (pattern.test(normalized)) return normalized;
    }
  }
  return null;
}

/**
 * Decide what this run covers.
 *
 * @returns {{ mode: "exhaustive"|"affected", stage: string, extraArgs: string[], reason: string }}
 */
export function resolveVitestSelection({
  changedFiles = null,
  baseRef = "",
  env = process.env,
} = {}) {
  const exhaustive = (reason) => ({
    mode: "exhaustive",
    stage: "exhaustive-vitest",
    extraArgs: [],
    reason,
  });

  const optOut = String(env?.[EXHAUSTIVE_ENV] ?? "").trim();
  if (optOut) return exhaustive(`opt-out:${optOut}`);

  const base = String(baseRef ?? "").trim();
  if (!base) return exhaustive("no-base-ref");

  if (!Array.isArray(changedFiles)) return exhaustive("changed-files-unreadable");

  const files = changedFiles
    .map((file) => String(file ?? "").trim())
    .filter(Boolean);

  // An empty diff is not permission to run nothing. Something computed the
  // wrong base, or the push carries no tree change at all; either way the
  // honest answer is the full suite.
  if (files.length === 0) return exhaustive("empty-diff");

  const trigger = exhaustiveTrigger(files);
  if (trigger) return exhaustive(`blast-radius-unbounded:${trigger}`);

  return {
    mode: "affected",
    stage: "affected-vitest",
    extraArgs: [`--changed=${base}`],
    reason: `changed-since:${base}`,
  };
}
