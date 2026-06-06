// apps/web/lib/build/wip-cap.ts
//
// Build Studio work-in-progress (WIP) cap.
//
// Why this exists:
//   Operators kept starting new feature builds while earlier ones sat
//   unfinished, leaving a queue full of half-done/stuck builds and nothing
//   shipped. Build Studio also shares ONE sandbox across all in-flight builds
//   (apps/web/lib/build/sandbox-driver.ts), so several builds in the BUILD
//   phase at once is actively unsafe (they collide on the same working tree).
//   This guard enforces a small WIP limit at the two entry points that create
//   builds (createFeatureBuild + the promote_to_build_studio MCP tool) so work
//   gets finished before new work starts.
//
//   The DB count is done at the call sites (typed against Prisma); this module
//   stays pure so the cap rule is trivially unit-tested. The where-clause to
//   count active builds is ACTIVE_BUILD_WIP_PHASES (non-terminal) + abandonedAt
//   null + parentEpicId null.
//
// This is the interim hard cap. The fuller queue UX (slots indicator + queued
// state badges) is designed in
// docs/superpowers/specs/2026-05-20-build-studio-layout-redesign-design.md §6.

/**
 * Max number of simultaneously-active feature builds. "Active" = not yet
 * complete/failed and not abandoned. Tunable; kept small on purpose because
 * all builds share one sandbox. 3 leaves room for a couple parked in
 * ideate/plan while one is actually building.
 */
export const BUILD_WIP_CAP = 3;

/** Phases that count as finished — they no longer occupy a WIP slot. */
export const TERMINAL_BUILD_PHASES = ["complete", "failed"] as const;

export class BuildWipCapError extends Error {
  readonly code = "BUILD_WIP_CAP_REACHED";
  readonly active: number;
  readonly cap: number;
  constructor(active: number, cap: number) {
    super(
      `You already have ${active} build${active === 1 ? "" : "s"} in progress ` +
        `(the limit is ${cap}). Finish or abandon one before starting a new build — ` +
        `Build Studio keeps work-in-progress low so things actually get completed.`,
    );
    this.name = "BuildWipCapError";
    this.active = active;
    this.cap = cap;
  }
}

/** True when `active` already-running builds means a new one would exceed the cap. */
export function wipCapReached(active: number, cap: number = BUILD_WIP_CAP): boolean {
  return active >= cap;
}

/**
 * Throw a BuildWipCapError if `active` running builds means starting another
 * would exceed the cap. Call after counting active builds at the start path.
 */
export function assertWipCapacity(active: number, cap: number = BUILD_WIP_CAP): void {
  if (wipCapReached(active, cap)) throw new BuildWipCapError(active, cap);
}
