// BI-DBF3F426 — Runtime-artifact janitor (pure decision library).
//
// Spec: docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md
//   §4.1 (worktree lifecycle + reaping) and §4.3 (sandbox & container discipline).
//
// This is the COMPLEMENT to the existing worktree janitor (scripts/worktree-janitor.sh,
// PR #1443) and the RuntimeTarget heartbeat sweep (runtime-target-janitor.ts, PR #1443).
// Those reap stale *worktrees* and stale *RuntimeTarget* / lease records. They do NOT
// reap the Docker side-effects that accumulate alongside them:
//
//   (a) per-branch local-CI build images  — `dpf-local-integration-<slug>-build`
//       (5 orphaned, ~20GB, observed 2026-06-05; spec §2 + §4.3). These are the
//       output of an agent building its own CI image instead of going through the
//       shared `local-integration-ci` lease — exactly the sprawl §4.3 prohibits.
//
//   (b) stray non-`dpf` compose projects — leftover `docker compose up` projects whose
//       project name is neither the root `dpf` nor an `dpf-<topic>` worktree project that
//       still has a live worktree. (BI-63C11CF7 keeps worktree compose isolated under
//       `dpf-<topic>`; this reaps the ones whose worktree is gone, plus truly foreign
//       projects.)
//
// SAFETY DOCTRINE (mirrors the worktree janitor + the "idle is not abandoned" rule):
//   * Pure decisions here; the CLI (runtime-artifact-janitor CLI) performs side effects.
//   * DRY-RUN is the caller's default; nothing in this module shells out.
//   * Staleness threshold defaults to 7 days so a week of operator travel never trips a
//     reap (founder rule: idle is not abandoned).
//   * The root `dpf` compose project is NEVER a reap candidate.
//   * A compose project whose worktree is still present (live `dpf-<topic>`) is NEVER a
//     reap candidate, regardless of age.
//   * No silent caps: the caller reports every candidate it found (founder rule:
//     no silent truncation).

export const ROOT_COMPOSE_PROJECT = "dpf";
export const DEFAULT_STALENESS_DAYS = 7;
export const MS_PER_DAY = 86_400_000;

/**
 * May the reaper delete the named Docker volumes of `projectName`?
 *
 * A compose `down --remove-orphans` reaps a stray project's containers + networks
 * but never its named volumes (the `pgdata` / `node_modules` volumes), so a
 * reaped project's storage lingers forever — the observed volume bloat: dead
 * `dpf-<topic>` dev stacks whose worktree is long gone still holding ~1GB pgdata +
 * node_modules each. Volume storage is only reclaimed when we ALSO remove those.
 *
 * This is the decision the "never-wipe-db rule" governs, so it is deliberately its
 * own gate rather than an inline `--volumes` flag on `down`:
 *   - A project only reaches here after decideComposeProject() already ruled it
 *     REAP — not root, no live worktree, idle past the staleness threshold. Its
 *     pgdata belongs to a branch that no longer exists on disk.
 *   - The root `dpf` project is refused here too, as defense-in-depth independent
 *     of the caller — deleting `dpf_pgdata` is the 2026-06-23 live-data revert
 *     (BI-B61779DB), which the compose-safety guard also blocks.
 *
 * @param {string} projectName
 * @returns {{ok:boolean, reason:string}}
 */
export function decideVolumeReclaim(projectName) {
  const name = String(projectName ?? "").trim();
  if (!name) {
    return { ok: false, reason: "empty project name — refusing volume reclaim" };
  }
  if (name.toLowerCase() === ROOT_COMPOSE_PROJECT) {
    return { ok: false, reason: "root dpf project — its volumes are never reclaimed" };
  }
  return { ok: true, reason: `stray project ${name} — its named volumes are orphaned and reclaimable` };
}

// `dpf-local-integration-<slug>-build` — the per-branch CI build image tag produced by
// scripts/lib/local-integration-ci.mjs `dockerBuildTag()`.
const CI_BUILD_IMAGE_RE = /^dpf-local-integration-[a-z0-9-]+-build$/i;

/**
 * Is this Docker image repository tag a per-branch local-CI build image?
 * Matches the `dockerBuildTag()` convention in local-integration-ci.mjs.
 */
export function isLocalCiBuildImage(repository) {
  if (!repository) return false;
  return CI_BUILD_IMAGE_RE.test(String(repository).trim());
}

/**
 * Days between `then` and `now` (both epoch ms). Negative/NaN clamps to 0 so a
 * clock skew or unparseable timestamp never *forces* a reap.
 */
export function ageInDays(thenMs, nowMs) {
  const then = Number(thenMs);
  const now = Number(nowMs);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return 0;
  const days = (now - then) / MS_PER_DAY;
  return days > 0 ? days : 0;
}

/**
 * Decide whether a single local-CI build image should be reaped.
 *
 * Per spec §4.3, per-branch CI build images are prohibited substrate — runtime gates
 * must go through the shared `local-integration-ci` lease. So *any* image matching the
 * tag convention is a reap candidate once it crosses the staleness threshold; we do not
 * additionally require the branch to be gone (the image should not exist at all). The
 * threshold is the only guard, and it is generous on purpose.
 *
 * @param {{repository:string, createdMs:number}} image
 * @param {{nowMs:number, stalenessDays?:number}} opts
 * @returns {{verdict:"REAP"|"KEEP", reason:string, ageDays:number}}
 */
export function decideBuildImage(image, opts) {
  const stalenessDays = opts.stalenessDays ?? DEFAULT_STALENESS_DAYS;
  const repository = image?.repository ?? "";

  if (!isLocalCiBuildImage(repository)) {
    return { verdict: "KEEP", reason: "not a dpf-local-integration-*-build image", ageDays: 0 };
  }

  const ageDays = ageInDays(image.createdMs, opts.nowMs);
  if (ageDays < stalenessDays) {
    return {
      verdict: "KEEP",
      reason: `per-branch CI image but only ${ageDays.toFixed(1)}d old (<${stalenessDays}d grace)`,
      ageDays,
    };
  }

  return {
    verdict: "REAP",
    reason: `orphaned per-branch CI image ${ageDays.toFixed(1)}d old (>=${stalenessDays}d); runtime gates must use the shared local-integration-ci lease (spec §4.3)`,
    ageDays,
  };
}

/**
 * Decide whether a docker compose project should be reaped.
 *
 * Reaped only when ALL hold:
 *   1. It is NOT the root `dpf` project (commandment: never touch root).
 *   2. It has no live worktree backing it. A `dpf-<topic>` project whose worktree is
 *      still present is active infrastructure — KEEP regardless of age.
 *   3. It has no running container. A stack that is still `Up` is in use right now,
 *      even if it was created long ago (a long-lived dev stack is created once and
 *      runs for weeks) — KEEP regardless of age, independent of worktree naming.
 *   4. Its newest container/volume is older than the staleness threshold.
 *
 * @param {{projectName:string, newestContainerCreatedMs:number, hasRunningContainer?:boolean}} project
 * @param {{
 *   nowMs:number,
 *   stalenessDays?:number,
 *   liveWorktreeProjectNames:Set<string>|string[],
 * }} opts
 * @returns {{verdict:"REAP"|"KEEP", reason:string, ageDays:number}}
 */
export function decideComposeProject(project, opts) {
  const stalenessDays = opts.stalenessDays ?? DEFAULT_STALENESS_DAYS;
  const name = String(project?.projectName ?? "").trim();
  const live =
    opts.liveWorktreeProjectNames instanceof Set
      ? opts.liveWorktreeProjectNames
      : new Set(opts.liveWorktreeProjectNames ?? []);

  if (!name) {
    return { verdict: "KEEP", reason: "empty project name", ageDays: 0 };
  }

  if (name.toLowerCase() === ROOT_COMPOSE_PROJECT) {
    return { verdict: "KEEP", reason: "root dpf project — never reaped", ageDays: 0 };
  }

  if (live.has(name)) {
    return { verdict: "KEEP", reason: `backed by a live worktree (${name})`, ageDays: 0 };
  }

  if (project?.hasRunningContainer) {
    return { verdict: "KEEP", reason: `has a running container (${name}) — in use`, ageDays: 0 };
  }

  const ageDays = ageInDays(project.newestContainerCreatedMs, opts.nowMs);
  if (ageDays < stalenessDays) {
    return {
      verdict: "KEEP",
      reason: `stray project but newest container only ${ageDays.toFixed(1)}d old (<${stalenessDays}d grace)`,
      ageDays,
    };
  }

  const kind = name.toLowerCase().startsWith("dpf-")
    ? "orphaned worktree compose project (no live worktree)"
    : "foreign (non-dpf) compose project";
  return {
    verdict: "REAP",
    reason: `${kind} ${ageDays.toFixed(1)}d idle (>=${stalenessDays}d)`,
    ageDays,
  };
}

/**
 * Plan a full reap pass over discovered build images and compose projects.
 * Returns every decision (no truncation) plus the REAP subsets.
 *
 * @param {{
 *   buildImages:Array<{repository:string, createdMs:number}>,
 *   composeProjects:Array<{projectName:string, newestContainerCreatedMs:number}>,
 *   liveWorktreeProjectNames:Set<string>|string[],
 *   nowMs:number,
 *   stalenessDays?:number,
 * }} input
 */
export function planReap(input) {
  const stalenessDays = input.stalenessDays ?? DEFAULT_STALENESS_DAYS;
  const nowMs = input.nowMs;
  const liveWorktreeProjectNames =
    input.liveWorktreeProjectNames instanceof Set
      ? input.liveWorktreeProjectNames
      : new Set(input.liveWorktreeProjectNames ?? []);

  const imageDecisions = (input.buildImages ?? []).map((image) => ({
    image,
    ...decideBuildImage(image, { nowMs, stalenessDays }),
  }));

  const projectDecisions = (input.composeProjects ?? []).map((project) => ({
    project,
    ...decideComposeProject(project, { nowMs, stalenessDays, liveWorktreeProjectNames }),
  }));

  return {
    stalenessDays,
    imageDecisions,
    projectDecisions,
    imagesToReap: imageDecisions.filter((d) => d.verdict === "REAP"),
    projectsToReap: projectDecisions.filter((d) => d.verdict === "REAP"),
  };
}
