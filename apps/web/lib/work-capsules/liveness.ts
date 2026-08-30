// apps/web/lib/work-capsules/liveness.ts
//
// WS9 (BI-CBAAEA94 / EP-PROCESS-SPINE) — the Workroom liveness contract.
//
// Why this exists:
//   A Workroom's `updatedAt` is NOT a liveness signal. Build Studio capsules
//   are born at the daily 14:00 governed-backlog tee-up and, if their build
//   stalls immediately, are never written again — so `updatedAt` freezes at
//   `...T14:00:00` forever while the row still says status="working". Dozens of
//   dead capsules therefore DISPLAY as active, jam the WIP cap, and become the
//   mechanism by which work is silently duplicated (the sprawl this WS fixes).
//
//   Real liveness comes from signals that only advance when work actually
//   advances:
//     - an OPEN PR (work parked in review / the merge queue),
//     - a lease-backed executor's `leaseExpiresAt` (external Claude/Codex/Grok;
//       auto-renewed on every capsule write — expiry == the session died),
//     - the linked Build Studio FeatureBuild's phase + last activity (a null-lease
//       BS capsule's only real signal), and
//     - `lastSyncedAt` (adopted-worktree cache sync).
//
//   This module is the ONE place those signals are combined into a verdict, so
//   the board, the `list_work_capsules` tool, and the governed reaper all agree.
//   It is intentionally PURE (no DB, no clock of its own — `now` is injected) so
//   it is exhaustively unit-testable.

import { WORK_CAPSULE_IDLE_STALE_MS } from "@/lib/work-capsules";

/** Capsule statuses that mean the work is already closed out. */
const TERMINAL_STATUSES = new Set(["complete", "abandoned", "archived"]);

/** Linked FeatureBuild phases that mean the build is closed out. */
const TERMINAL_BUILD_PHASES = new Set(["complete", "failed", "abandoned"]);

export type WorkCapsuleLiveness =
  /** Demonstrably live: valid lease, open PR, or recent real activity. */
  | "live"
  /** Server-owned nonproduction capacity wait; the executor is suspended, not dead. */
  | "durable-wait"
  /** Lease-backed executor whose lease has elapsed — the session died. */
  | "lease-expired"
  /** Linked Build Studio build is complete/failed/abandoned — nothing to do. */
  | "build-terminal"
  /** No live signal and older than the idle floor (the frozen-14:00 case). */
  | "idle-stale"
  /** Capsule status is already terminal (complete/abandoned/archived). */
  | "terminal"
  /** Null lease, no build/sync signal, but recent enough to withhold judgment. */
  | "no-signal";

/** The dead states a governed reaper may act on. Excludes `terminal` (already
 *  closed) and `no-signal`/`live` (benefit of the doubt). */
const REAPABLE_LIVENESS = new Set<WorkCapsuleLiveness>([
  "lease-expired",
  "build-terminal",
  "idle-stale",
]);

export type CapsuleLivenessInput = {
  status: string;
  executorKind: string | null;
  leaseExpiresAt: Date | null;
  lastSyncedAt: Date | null;
  updatedAt: Date;
  pullRequestUrl: string | null;
  pullRequestNumber?: number | null;
  /**
   * Snapshot of the linked Build Studio FeatureBuild, when this capsule is a
   * build-studio capsule and the caller has loaded it. `phase` drives the
   * build-terminal verdict; `lastActivityAt` is the freshest real signal a
   * null-lease capsule has. Absent/null for non-BS capsules or when not loaded.
   */
  featureBuild?: { phase: string | null; lastActivityAt: Date | null } | null;
  durableWait?: { state: "queued" | "active"; signaledAt: Date | null } | null;
};

export type CapsuleLivenessVerdict = {
  liveness: WorkCapsuleLiveness;
  /** True when this should read as ACTIVE on a board. `no-signal` (recent but
   *  unproven) counts as live so a brand-new capsule is never shown as dead. */
  isLive: boolean;
  /** True when a governed reaper may transition this capsule to abandoned. */
  isReapable: boolean;
  reason: string;
  /**
   * The timestamp that actually governs liveness — lease expiry, last build
   * activity, or last sync. Deliberately NEVER `updatedAt` (which the 14:00
   * heartbeat masks). Null when the only available signal was `updatedAt`.
   */
  trueLivenessAt: Date | null;
};

function hasOpenPr(input: CapsuleLivenessInput): boolean {
  return Boolean(input.pullRequestUrl) || (input.pullRequestNumber ?? 0) > 0;
}

function humanAge(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

/**
 * Classify a capsule's TRUE liveness from signals that only advance with real
 * work. Pure: `now` is injected. Precedence, most authoritative first:
 *   1. terminal capsule status,
 *   2. open PR (parked in review),
 *   3. terminal linked build,
 *   4. lease-backed executor: lease valid → live, elapsed → dead,
 *   5. null lease: freshest of (build activity, sync) vs the idle floor,
 *   6. no signal at all: recent → withhold judgment, old → idle-stale.
 */
export function classifyWorkCapsuleLiveness(
  input: CapsuleLivenessInput,
  now: Date = new Date(),
  idleMs: number = WORK_CAPSULE_IDLE_STALE_MS,
): CapsuleLivenessVerdict {
  const verdict = (
    liveness: WorkCapsuleLiveness,
    reason: string,
    trueLivenessAt: Date | null,
  ): CapsuleLivenessVerdict => ({
    liveness,
    isLive: liveness === "live" || liveness === "durable-wait" || liveness === "no-signal",
    isReapable: REAPABLE_LIVENESS.has(liveness),
    reason,
    trueLivenessAt,
  });

  if (TERMINAL_STATUSES.has(input.status)) {
    return verdict("terminal", `Capsule already ${input.status}.`, null);
  }

  // An open PR is the live artifact even if the authoring session's lease has
  // since lapsed — the work is in review / the merge queue, not abandoned.
  if (hasOpenPr(input)) {
    const label = input.pullRequestNumber ? `PR #${input.pullRequestNumber}` : "an open PR";
    return verdict("live", `Parked in review as ${label}.`, input.lastSyncedAt ?? null);
  }

  if (input.durableWait) {
    const action = input.durableWait.state === "active" ? "executing" : "waiting for capacity";
    return verdict(
      "durable-wait",
      `Durable nonproduction lease is ${action}; the Workroom must not be reaped.`,
      input.durableWait.signaledAt,
    );
  }

  const build = input.featureBuild ?? null;
  if (build && build.phase && TERMINAL_BUILD_PHASES.has(build.phase)) {
    return verdict(
      "build-terminal",
      `Linked build is ${build.phase} — capsule should be closed out.`,
      build.lastActivityAt ?? null,
    );
  }

  // Lease-backed executor: the lease IS the liveness contract.
  if (input.leaseExpiresAt != null) {
    const expired = input.leaseExpiresAt.getTime() <= now.getTime();
    if (expired) {
      const age = humanAge(now.getTime() - input.leaseExpiresAt.getTime());
      return verdict("lease-expired", `Lease expired ${age} ago — session died.`, input.leaseExpiresAt);
    }
    const remaining = humanAge(input.leaseExpiresAt.getTime() - now.getTime());
    return verdict("live", `Lease valid for ${remaining}.`, input.leaseExpiresAt);
  }

  // Null lease (e.g. a Build Studio capsule): use the freshest REAL signal.
  const buildActivityAt = build?.lastActivityAt ?? null;
  const signalAt =
    buildActivityAt && input.lastSyncedAt
      ? new Date(Math.max(buildActivityAt.getTime(), input.lastSyncedAt.getTime()))
      : buildActivityAt ?? input.lastSyncedAt ?? null;

  if (signalAt) {
    const age = now.getTime() - signalAt.getTime();
    if (age <= idleMs) {
      const which = signalAt === input.lastSyncedAt ? "Synced" : "Build activity";
      return verdict("live", `${which} ${humanAge(age)} ago.`, signalAt);
    }
    return verdict("idle-stale", `No live signal for ${humanAge(age)} (past the ${humanAge(idleMs)} idle floor).`, signalAt);
  }

  // No lease, no build activity, no sync — `updatedAt` is the only marker, and it
  // is NOT a liveness signal (frozen at 14:00 birth). Withhold judgment while
  // recent; flip to idle-stale once past the floor.
  const updatedAge = now.getTime() - input.updatedAt.getTime();
  if (updatedAge <= idleMs) {
    return verdict("no-signal", `No lease or activity signal yet (created ${humanAge(updatedAge)} ago).`, null);
  }
  return verdict(
    "idle-stale",
    `No lease, sync, or build activity — last touched ${humanAge(updatedAge)} ago (updatedAt is not liveness).`,
    null,
  );
}
