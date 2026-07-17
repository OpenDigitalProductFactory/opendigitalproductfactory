// apps/web/lib/build/unified-wip.ts
//
// BI-937128F6 / EP-UNIFIED-TRACKING — unified WIP across all delivery surfaces.
//
// Founder directive (Mark, 2026-06-26): the unit of WIP is the WorkCapsule, not
// the Build Studio build. Forcing all work through BS to gain central tracking
// was futile; instead every surface (BS + external Claude/Codex/Grok CLIs)
// registers a capsule, and the platform's WIP picture derives from active
// capsules across ALL surfaces — gated by the REAL scarce resources, not a
// BS-only build count.
//
// Why the BS cap (wip-cap.ts) is BS-only today: it exists because Build Studio
// shares ONE sandbox across in-flight builds, so concurrent BUILD-phase builds
// collide on the same working tree. External surfaces work in their OWN host
// worktrees and do NOT contend on the BS sandbox, so they must NOT be blocked by
// the BS cap — but their active capsules MUST still count in the unified WIP
// view, and runtime-bound external work IS gated by the shared singleton lease
// (NonProductionEnvironmentLease, e.g. :3001).
//
// This module is intentionally PURE (no DB import): callers supply the active
// WIP items; it classifies them by the finite resource pool each contends on and
// returns an operator-readable summary. The DB queries (active WorkCapsules by
// executorKind), the promote Definition-of-Ready wiring, and the operator view
// are the follow-up slice tracked on BI-937128F6.

/** The finite resource pool a unit of active work contends on. */
export type WipPool = "bs-sandbox" | "shared-lease" | "host-worktree" | "none";

/** A single unit of active work, surface-tagged via its capsule executorKind. */
export interface ActiveWipItem {
  /** WorkCapsule executorKind: build-studio | claude/codex/grok/antigravity-desktop | dpf-native | human | git-webhook. */
  readonly executorKind: string;
  /** True when this work currently holds a shared singleton lease (e.g. the :3001 nonprod lease). */
  readonly holdsSharedLease?: boolean;
}

export interface UnifiedWipSummary {
  /** Total active WIP across every surface — the central number the platform must see. */
  readonly total: number;
  /** Active count per surface (executorKind). */
  readonly perSurface: Readonly<Record<string, number>>;
  /** Work gated by the Build Studio shared sandbox (the BUILD_WIP_CAP constraint). */
  readonly bsSandboxContending: number;
  /** External work gated by a shared singleton lease (e.g. the :3001 nonprod lease). */
  readonly sharedLeaseContending: number;
  /** External work that contends on no shared singleton (its own host worktree). */
  readonly hostWorktreeOnly: number;
}

/** Build Studio is the only surface that contends on the shared BS sandbox. */
export function contendsOnBsSandbox(executorKind: string): boolean {
  return executorKind === "build-studio";
}

/**
 * Summarize active WIP across all surfaces and classify each unit by the finite
 * resource pool it contends on. Pure: the caller decides which capsules/builds
 * are "active" and whether each holds a shared lease.
 */
export function summarizeUnifiedWip(items: readonly ActiveWipItem[]): UnifiedWipSummary {
  const perSurface: Record<string, number> = {};
  let bsSandboxContending = 0;
  let sharedLeaseContending = 0;
  let hostWorktreeOnly = 0;

  for (const item of items) {
    perSurface[item.executorKind] = (perSurface[item.executorKind] ?? 0) + 1;
    if (contendsOnBsSandbox(item.executorKind)) {
      bsSandboxContending += 1;
    } else if (item.holdsSharedLease) {
      sharedLeaseContending += 1;
    } else {
      hostWorktreeOnly += 1;
    }
  }

  return {
    total: items.length,
    perSurface,
    bsSandboxContending,
    sharedLeaseContending,
    hostWorktreeOnly,
  };
}

/**
 * The pool that should GATE a given surface's new work. Build Studio gates on the
 * shared sandbox; runtime-bound external work gates on the shared lease; other
 * external work contends on nothing shared (never blocked by the BS cap).
 */
export function gatingPool(executorKind: string, holdsSharedLease = false): WipPool {
  if (contendsOnBsSandbox(executorKind)) return "bs-sandbox";
  if (holdsSharedLease) return "shared-lease";
  if (executorKind === "human" || executorKind === "git-webhook") return "none";
  return "host-worktree";
}

/** One-line operator-readable rendering of the unified WIP picture. */
export function renderUnifiedWip(summary: UnifiedWipSummary): string {
  const bySurface = Object.entries(summary.perSurface)
    .map(([kind, n]) => `${kind}=${n}`)
    .join(", ");
  return (
    `WIP ${summary.total} across surfaces (${bySurface || "none"}) — ` +
    `bs-sandbox ${summary.bsSandboxContending}, shared-lease ${summary.sharedLeaseContending}, ` +
    `host-worktree ${summary.hostWorktreeOnly}`
  );
}
