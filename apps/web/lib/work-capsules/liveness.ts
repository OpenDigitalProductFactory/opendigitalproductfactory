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

/** Durable TaskRun states that prove the authoring turn can no longer advance. */
const TERMINAL_TASK_RUN_STATUSES = new Set([
  "completed",
  "failed",
  "canceled",
  "rejected",
  "archived",
]);

export type WorkCapsuleLiveness =
  /** Demonstrably live: valid lease, open PR, or recent real activity. */
  | "live"
  /** Work is DELIVERED: its branch head is reachable from the trunk (merged).
   *  The session need not resume; the room is closed out as delivered, not
   *  abandoned. Detected procedurally from local git reachability — no LLM, no
   *  GitHub API. */
  | "delivered"
  /** Server-owned nonproduction capacity wait; the executor is suspended, not dead. */
  | "durable-wait"
  /** Lease-backed external session whose lease elapsed but only recently — a
   *  token-limited client is PAUSED, not dead, and resumes + renews when tokens
   *  return. Withheld from reaping until past the resume grace window. */
  | "paused"
  /** Lease-backed executor whose lease elapsed past the resume grace — the
   *  session is truly gone. */
  | "lease-expired"
  /** Lease is VALID but nothing says work is happening. `heartbeatWorkCapsule`
   *  writes only `leaseHolderPrincipalId` and `leaseExpiresAt`, so a loop that
   *  only heartbeats renews the lease forever with nothing to show for it. The
   *  room is held, not worked. NOT reapable: the lease is still valid and the
   *  holder may resume at any moment — the reaper waits for expiry as before
   *  (BI-7271460C). */
  | "leased-idle"
  /** Linked Build Studio build is complete/failed/abandoned — nothing to do. */
  | "build-terminal"
  /** Linked TaskRun/turn is terminal while stale session state still claims activity. */
  | "execution-terminal"
  /** Independently durable facts contradict; preserve the room for reconciliation. */
  | "recovery-required"
  /** No live signal and older than the idle floor (the frozen-14:00 case). */
  | "idle-stale"
  /** Capsule status is already terminal (complete/abandoned/archived). */
  | "terminal"
  /** Null lease, no build/sync signal, but recent enough to withhold judgment. */
  | "no-signal";

/**
 * Is an agent demonstrably WORKING in this room, as opposed to merely holding it?
 *
 * `isLive` on the verdict answers the weaker, safety-oriented question ("is it
 * held — do not steal or reap"), which `leased-idle` satisfies. An operator
 * surface asking "who is actually working" must ask this instead, or it repeats
 * the conflation this exists to remove (BI-7271460C).
 */
export function isDemonstrablyWorking(liveness: WorkCapsuleLiveness): boolean {
  return liveness === "live" || liveness === "durable-wait";
}

/** How a governed reaper should close a room the classifier says to act on. */
export type WorkCapsuleDisposition =
  /** Work merged — archive as delivered; safe to reap worktree + merged branch. */
  | "delivered"
  /** Session dead, work not merged — abandon; branch is UNMERGED (its commits
   *  live only there) so it is protected from deletion pending operator review. */
  | "abandoned";

/** The states a governed reaper may act on. `delivered` closes out as delivered;
 *  the dead states abandon. Excludes `terminal` (already closed), `paused`
 *  (may resume), and `no-signal`/`live` (benefit of the doubt). */
const REAPABLE_LIVENESS = new Set<WorkCapsuleLiveness>([
  "delivered",
  "lease-expired",
  "build-terminal",
  "execution-terminal",
  "idle-stale",
]);

/** Default resume grace for a lease-expired external session: a token-limited
 *  client (Claude/Codex/Grok) may be down for a usage-window duration and will
 *  return. Conservative — err toward NOT reaping a session that may resume. A
 *  DELIVERED (merged) room bypasses the grace: it need not resume. */
export const WORK_CAPSULE_PAUSE_GRACE_MS = 24 * 60 * 60 * 1000;

/** Provider "open" is a renewable liveness fact, not a permanent property. */
export const WORK_CAPSULE_OPEN_PR_FRESHNESS_MS = 20 * 60 * 1000;
const PROVIDER_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type CapsuleLivenessInput = {
  status: string;
  executorKind: string | null;
  leaseExpiresAt: Date | null;
  lastSyncedAt: Date | null;
  updatedAt: Date;
  pullRequestUrl: string | null;
  pullRequestNumber?: number | null;
  /** Verified provider state for this exact repository/PR/authored-head tuple. */
  pullRequestObservation?: {
    state: "open" | "merged" | "closed";
    observedAt: Date;
  } | null;
  /**
   * Snapshot of the linked Build Studio FeatureBuild, when this capsule is a
   * build-studio capsule and the caller has loaded it. `phase` drives the
   * build-terminal verdict; `lastActivityAt` is the freshest real signal a
   * null-lease capsule has. Absent/null for non-BS capsules or when not loaded.
   */
  featureBuild?: { phase: string | null; lastActivityAt: Date | null } | null;
  /** Independent durable execution state; provider/session flags cannot override it. */
  taskRun?: { status: string | null; updatedAt: Date | null } | null;
  durableWait?: { state: "queued" | "active"; signaledAt: Date | null } | null;
  /**
   * Whether this capsule's work is DELIVERED, computed by the caller from a
   * verified provider observation or positive local git reachability — never an
   * LLM. When `merged` is true the room is closed out regardless of lease state.
   */
  deliveredSignal?: { merged: boolean } | null;
};

export type CapsuleLivenessVerdict = {
  liveness: WorkCapsuleLiveness;
  /** True when this should read as ACTIVE on a board. `no-signal` (recent but
   *  unproven) counts as live so a brand-new capsule is never shown as dead;
   *  `paused` counts as live so a token-limited session that may resume is not
   *  shown as dead. */
  isLive: boolean;
  /** True when a governed reaper may act on this capsule (close it out). See
   *  {@link disposition} for how. */
  isReapable: boolean;
  /** How to close out, when reapable: `delivered` (archive) vs `abandoned`. Null
   *  when not reapable. */
  disposition: WorkCapsuleDisposition | null;
  reason: string;
  /**
   * The timestamp that actually governs liveness — lease expiry, last build
   * activity, or last sync. Deliberately NEVER `updatedAt` (which the 14:00
   * heartbeat masks). Null when the only available signal was `updatedAt`.
   */
  trueLivenessAt: Date | null;
};

function hasOpenPr(input: CapsuleLivenessInput, now: Date): boolean {
  if (
    !input.pullRequestObservation ||
    input.pullRequestObservation.state !== "open" ||
    (!input.pullRequestUrl && (input.pullRequestNumber ?? 0) <= 0)
  ) {
    return false;
  }
  const age = now.getTime() - input.pullRequestObservation.observedAt.getTime();
  return age >= -PROVIDER_CLOCK_SKEW_MS && age <= WORK_CAPSULE_OPEN_PR_FRESHNESS_MS;
}

/**
 * The freshest signal that only advances when real work happens.
 *
 * Deliberately excludes `leaseExpiresAt` (a heartbeat moves it with no work
 * behind it) and `updatedAt` (the 14:00 birth-time mask). Shared by the leased
 * and null-lease branches so both answer "is work happening" the same way,
 * rather than the lease branch answering an easier question (BI-7271460C).
 */
function freshestWorkSignal(
  input: CapsuleLivenessInput,
  build: { lastActivityAt?: Date | null } | null,
): Date | null {
  const buildActivityAt = build?.lastActivityAt ?? null;
  if (buildActivityAt && input.lastSyncedAt) {
    return new Date(Math.max(buildActivityAt.getTime(), input.lastSyncedAt.getTime()));
  }
  return buildActivityAt ?? input.lastSyncedAt ?? null;
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
  pauseGraceMs: number = WORK_CAPSULE_PAUSE_GRACE_MS,
): CapsuleLivenessVerdict {
  const verdict = (
    liveness: WorkCapsuleLiveness,
    reason: string,
    trueLivenessAt: Date | null,
  ): CapsuleLivenessVerdict => ({
    liveness,
    // `paused` reads as live so a token-limited session that may resume is never
    // shown as dead or reaped; `delivered` does NOT (it should be closed out).
    // `isLive` answers "is this room HELD — keep hands off", which is what
    // ownership, claim refusal and the reaper all need. It is NOT "is an agent
    // demonstrably working": `leased-idle` is held under a valid lease with
    // nothing to show, and weakening it here would let a second agent steal a
    // branch someone still holds. Ask `liveness === "live"` for the stronger
    // question; the two were one field and that was the defect (BI-7271460C).
    isLive:
      liveness === "live" ||
      liveness === "durable-wait" ||
      liveness === "no-signal" ||
      liveness === "leased-idle" ||
      liveness === "paused",
    isReapable: REAPABLE_LIVENESS.has(liveness),
    disposition:
      liveness === "delivered"
        ? "delivered"
        : REAPABLE_LIVENESS.has(liveness)
          ? "abandoned"
          : null,
    reason,
    trueLivenessAt,
  });

  if (TERMINAL_STATUSES.has(input.status)) {
    return verdict("terminal", `Capsule already ${input.status}.`, null);
  }

  // DELIVERED wins over every liveness signal. The caller may prove it from an
  // exact authenticated provider merge or positive local trunk reachability.
  if (input.deliveredSignal?.merged) {
    return verdict(
      "delivered",
      "Work merged (branch reachable from trunk) — closing out as delivered.",
      input.lastSyncedAt ?? input.leaseExpiresAt ?? null,
    );
  }

  // An open PR is the live artifact even if the authoring session's lease has
  // since lapsed — the work is in review / the merge queue, not abandoned.
  if (hasOpenPr(input, now)) {
    const label = input.pullRequestNumber ? `PR #${input.pullRequestNumber}` : "an open PR";
    return verdict(
      "live",
      `Parked in review as ${label} (verified provider observation).`,
      input.pullRequestObservation?.observedAt ?? null,
    );
  }

  const taskRun = input.taskRun ?? null;
  const taskRunTerminal = Boolean(
    taskRun?.status && TERMINAL_TASK_RUN_STATUSES.has(taskRun.status),
  );
  if (taskRunTerminal && input.durableWait) {
    return verdict(
      "recovery-required",
      `TaskRun is ${taskRun?.status} but a durable nonproduction wait remains active; reconcile the stale fact before reaping or resuming.`,
      taskRun?.updatedAt ?? input.durableWait.signaledAt,
    );
  }
  if (taskRunTerminal) {
    return verdict(
      "execution-terminal",
      `TaskRun is ${taskRun?.status}; stale provider-session or lease state cannot keep the Workroom active.`,
      taskRun?.updatedAt ?? null,
    );
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

  // Lease-backed executor: the lease IS the liveness contract. On expiry, a
  // token-limited client is PAUSED (not dead) and resumes + renews when tokens
  // return, so withhold reaping until past the resume grace window.
  if (input.leaseExpiresAt != null) {
    const elapsed = now.getTime() - input.leaseExpiresAt.getTime();
    const expired = elapsed >= 0;
    if (expired) {
      const age = humanAge(elapsed);
      if (elapsed <= pauseGraceMs) {
        return verdict(
          "paused",
          `Lease expired ${age} ago — within the ${humanAge(pauseGraceMs)} resume grace; a token-limited session may return.`,
          input.leaseExpiresAt,
        );
      }
      return verdict(
        "lease-expired",
        `Lease expired ${age} ago — past the ${humanAge(pauseGraceMs)} resume grace; session is gone.`,
        input.leaseExpiresAt,
      );
    }
    // A valid lease says someone HOLDS this room. It does not say work is
    // happening, and the two were conflated (BI-7271460C). `heartbeatWorkCapsule`
    // updates only the lease holder and expiry — no sync, no evidence — so an
    // agent that heartbeats every 30 minutes and does nothing else reads exactly
    // like an agent delivering. WC-1B73A988 read `live` for three days on a
    // branch whose PR had already merged, because the lease alone answered.
    //
    // So the lease is necessary, not sufficient: it must be backed by the same
    // real signal the null-lease branch below already demands. `leaseExpiresAt`
    // is deliberately NOT a candidate signal here — that is the circularity.
    const remaining = humanAge(input.leaseExpiresAt.getTime() - now.getTime());
    const leasedSignalAt = freshestWorkSignal(input, build);
    if (leasedSignalAt) {
      const age = now.getTime() - leasedSignalAt.getTime();
      if (age <= idleMs) {
        return verdict(
          "live",
          `Lease valid for ${remaining}; work signal ${humanAge(age)} ago.`,
          leasedSignalAt,
        );
      }
      return verdict(
        "leased-idle",
        `Lease valid for ${remaining}, but no work signal for ${humanAge(age)} (past the ${humanAge(idleMs)} idle floor) — a heartbeat renews the lease without doing work.`,
        leasedSignalAt,
      );
    }
    return verdict(
      "leased-idle",
      `Lease valid for ${remaining}, but nothing has recorded work on this room — a heartbeat renews the lease without doing work.`,
      null,
    );
  }

  // Null lease (e.g. a Build Studio capsule): use the freshest REAL signal — the
  // same one the leased branch above now demands, from the same helper, so the
  // two branches cannot drift into answering different questions.
  const signalAt = freshestWorkSignal(input, build);

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
