/**
 * Activity Quiescence Protocol — caller API + state helpers + level reader.
 *
 * Sibling to activity.ts (the Phase 0 stopgap this replaces). All callers
 * that need to coordinate a portal drain (self-upgrade, manual maintenance,
 * sandbox-recovery) use `startQuiescence` + `awaitReady` + `signalSwapComplete`
 * from this module. The hot-path `getQuiescenceLevel` is consumed by the
 * Proxy + Node state route (BI-QUIESCE-003) and by Inngest gates
 * (BI-QUIESCE-004a/b) for stop-accept enforcement.
 *
 * Spec: docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md
 *   §5.1 (QuiescenceRun entity)
 *   §5.2 (state machine)
 *   §5.4 (this caller API)
 *   §5.5 (wait budgets)
 *   §5.6 (ActiveSessionBlockers shape)
 *
 * BI-QUIESCE-002.
 */
import { prisma } from "@dpf/db";
import { recentActivityWhere } from "@/lib/self-upgrade/activity-signal";
import { sanitizeForLog } from "@/lib/security/safe-log";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { TASK_LIVE_STATES } from "@/lib/tak/task-states";
import { newestSignal, isStale } from "@/lib/shared/staleness";

// ─── Quiescence level — runtime state, hot-read by middleware + gates ────

export type QuiescenceLevel = "normal" | "draining" | "swapping";

/**
 * PlatformConfig key holding the current quiescence level + active runId.
 * Single source of truth; the row is upserted atomically on transitions.
 *
 * Shape:
 *   { level: "normal" | "draining" | "swapping",
 *     runId: string | null,
 *     enteredAt: ISO string }
 */
export const QUIESCENCE_CONFIG_KEY = "portal.quiescence";

export type QuiescenceConfig = {
  level: QuiescenceLevel;
  runId: string | null;
  enteredAt: string; // ISO
};

const DEFAULT_CONFIG: QuiescenceConfig = {
  level: "normal",
  runId: null,
  enteredAt: "1970-01-01T00:00:00.000Z",
};

// In-memory cache. 1s TTL — operator-driven flips don't need sub-second
// freshness, and middleware + Inngest gates query on every request /
// step boundary, so caching avoids a DB round-trip in the hot path.
type CacheEntry = { config: QuiescenceConfig; readAt: number };
let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 1_000;

/**
 * Hot-path read of the current quiescence level.
 *
 * Cached for {@link CACHE_TTL_MS}. Cache invalidates after that window;
 * coordinator transitions also explicitly invalidate via
 * {@link invalidateQuiescenceCache} so a fresh write is visible immediately
 * within the writing process.
 *
 * Must be <1ms p99 in cache-hit paths. Test override allows deterministic
 * cache control without mocking Date globally.
 */
export async function getQuiescenceLevel(now: Date = new Date()): Promise<QuiescenceLevel> {
  const config = await getQuiescenceConfig(now);
  return config.level;
}

export async function getQuiescenceConfig(now: Date = new Date()): Promise<QuiescenceConfig> {
  if (cache && now.getTime() - cache.readAt < CACHE_TTL_MS) {
    return cache.config;
  }
  if (typeof prisma.platformConfig?.findUnique !== "function") {
    const config = { ...DEFAULT_CONFIG };
    cache = { config, readAt: now.getTime() };
    return config;
  }
  const row = await prisma.platformConfig.findUnique({
    where: { key: QUIESCENCE_CONFIG_KEY },
  });
  const config = parseQuiescenceConfig(row?.value ?? null);
  cache = { config, readAt: now.getTime() };
  return config;
}

export function parseQuiescenceConfig(raw: unknown): QuiescenceConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CONFIG };
  const cfg = raw as Record<string, unknown>;
  const level: QuiescenceLevel =
    cfg.level === "draining" || cfg.level === "swapping" ? cfg.level : "normal";
  return {
    level,
    runId: typeof cfg.runId === "string" ? cfg.runId : null,
    enteredAt: typeof cfg.enteredAt === "string" ? cfg.enteredAt : DEFAULT_CONFIG.enteredAt,
  };
}

/**
 * Coordinator-driven cache invalidation. Called on every level transition
 * so a coordinator's own subsequent reads see its write immediately, not
 * up-to-CACHE_TTL_MS stale.
 *
 * Cross-process invalidation is bounded by CACHE_TTL_MS — other Next.js /
 * Inngest worker processes converge within 1 second of any flip.
 */
export function invalidateQuiescenceCache(): void {
  cache = null;
}

/**
 * Writes a new quiescence level to PlatformConfig. Called by the coordinator
 * function during state transitions. Single statement upsert; the cache is
 * invalidated synchronously so in-process readers see the change immediately.
 *
 * Not exported as part of the caller API — only the coordinator writes here.
 * Callers use `startQuiescence` / `signalSwapComplete` / `abortQuiescence`.
 */
export async function setQuiescenceLevel(
  level: QuiescenceLevel,
  runId: string | null,
  now: Date = new Date(),
): Promise<void> {
  const config: QuiescenceConfig = {
    level,
    runId,
    enteredAt: now.toISOString(),
  };
  await prisma.platformConfig.upsert({
    where: { key: QUIESCENCE_CONFIG_KEY },
    create: { key: QUIESCENCE_CONFIG_KEY, value: config as unknown as object },
    update: { value: config as unknown as object },
  });
  invalidateQuiescenceCache();
}

// ─── QuiescenceRun lifecycle helpers ─────────────────────────────────────

export const QUIESCENCE_RUN_STATUSES = [
  "pending",
  "preparing",
  "draining",
  "ready-to-swap",
  "swapping",
  "completed",
  "deferred",
  "aborted",
  "failed",
] as const;

export type QuiescenceRunStatus = (typeof QUIESCENCE_RUN_STATUSES)[number];

export const TERMINAL_QUIESCENCE_STATUSES: ReadonlySet<QuiescenceRunStatus> = new Set([
  "completed",
  "deferred",
  "aborted",
  "failed",
]);

export function isTerminalQuiescenceStatus(status: string): boolean {
  return TERMINAL_QUIESCENCE_STATUSES.has(status as QuiescenceRunStatus);
}

export type QuiescenceTrigger = "self-upgrade" | "manual" | "sandbox-recovery";

/**
 * Per-state entry timestamps stored in QuiescenceRun.enteredStateAt.
 * Recorded as ISO strings so the JSON column is human-readable.
 */
export type EnteredStateAt = Partial<Record<QuiescenceRunStatus, string>>;

/**
 * Single canonical state transition. Updates status + the per-state entry
 * timestamp + any outcome-related fields in one statement. The cache is
 * invalidated when level state is also touched.
 *
 * Returns the post-update row so callers can verify the transition (e.g.,
 * spot a concurrent transition that already advanced past the requested
 * state — defensive against the watchdog racing the coordinator).
 */
export async function transitionState(
  runId: string,
  toStatus: QuiescenceRunStatus,
  patches: {
    initialSnapshot?: unknown;
    finalSnapshot?: unknown;
    swapStartedAt?: Date;
    swapCompletedAt?: Date;
    completedAt?: Date;
    deferReason?: string;
    deferSurface?: string;
    forcedSurfaces?: unknown[];
    outcome?: string;
    completionSource?: string;
    outcomeNotes?: string;
    actualWaitMs?: number;
  } = {},
  now: Date = new Date(),
): Promise<{ status: string; enteredStateAt: EnteredStateAt } | null> {
  const row = await prisma.quiescenceRun.findUnique({
    where: { runId },
    select: { enteredStateAt: true },
  });
  if (!row) return null;
  const prior =
    (row.enteredStateAt as unknown as EnteredStateAt | null | undefined) ?? {};
  const enteredStateAt: EnteredStateAt = { ...prior, [toStatus]: now.toISOString() };

  const updated = await prisma.quiescenceRun.update({
    where: { runId },
    data: {
      status: toStatus,
      enteredStateAt: enteredStateAt as unknown as object,
      ...(patches.initialSnapshot !== undefined
        ? { initialSnapshot: patches.initialSnapshot as unknown as object }
        : {}),
      ...(patches.finalSnapshot !== undefined
        ? { finalSnapshot: patches.finalSnapshot as unknown as object }
        : {}),
      ...(patches.swapStartedAt !== undefined ? { swapStartedAt: patches.swapStartedAt } : {}),
      ...(patches.swapCompletedAt !== undefined ? { swapCompletedAt: patches.swapCompletedAt } : {}),
      ...(patches.completedAt !== undefined ? { completedAt: patches.completedAt } : {}),
      ...(patches.deferReason !== undefined ? { deferReason: patches.deferReason } : {}),
      ...(patches.deferSurface !== undefined ? { deferSurface: patches.deferSurface } : {}),
      ...(patches.forcedSurfaces !== undefined
        ? { forcedSurfaces: patches.forcedSurfaces as unknown as object }
        : {}),
      ...(patches.outcome !== undefined ? { outcome: patches.outcome } : {}),
      ...(patches.completionSource !== undefined
        ? { completionSource: patches.completionSource }
        : {}),
      ...(patches.outcomeNotes !== undefined ? { outcomeNotes: patches.outcomeNotes } : {}),
      ...(patches.actualWaitMs !== undefined ? { actualWaitMs: patches.actualWaitMs } : {}),
    },
    select: { status: true, enteredStateAt: true },
  });

  return {
    status: updated.status,
    enteredStateAt: (updated.enteredStateAt as unknown as EnteredStateAt | null) ?? {},
  };
}

/**
 * Coordinator function heartbeat — fired every wait-loop tick. Cheap update;
 * the watchdog (BI-QUIESCE-007) scans `lastHeartbeatAt` to detect crashed
 * coordinators.
 */
export async function heartbeatQuiescenceRun(
  runId: string,
  now: Date = new Date(),
): Promise<void> {
  await prisma.quiescenceRun.update({
    where: { runId },
    data: { lastHeartbeatAt: now },
  });
}

/**
 * Flips every actively-working TaskRun to 'quiescing' status. Triggered on
 * the normal→draining transition. The cooperative-cancel pathway in
 * heartbeat.ts:27 then fires on the loop's next heartbeat (the filter is
 * `status IN ('working','active')`), exiting at the iteration boundary.
 *
 * Single UPDATE statement so it's atomic even at high TaskRun row counts.
 */
export async function flipActiveTaskRunsToQuiescing(now: Date = new Date()): Promise<number> {
  const result = await prisma.taskRun.updateMany({
    where: { status: { in: [...TASK_LIVE_STATES] } },
    data: { status: "quiescing", quiescedAt: now },
  });
  return result.count;
}

// ─── Caller API ──────────────────────────────────────────────────────────

export type QuiescenceOutcome =
  | { ok: true; outcome: "ready-to-swap"; runId: string; finalSnapshot: ActiveSessionBlockers }
  | { ok: false; outcome: "deferred"; runId: string; deferSurface: string | null; finalSnapshot: ActiveSessionBlockers | null }
  | { ok: false; outcome: "aborted" | "failed"; runId: string; reason: string };

export type StartQuiescenceOpts = {
  trigger: QuiescenceTrigger;
  triggerRefId?: string;
  budgetMs?: number;
  targetVersion?: string;
  targetBundleHash?: string;
  /**
   * Operator-acknowledged emergency override for the ship-phase
   * BuildPhaseRun blocker. Per spec §6.5 + taskrun-recovery.ts:191-197
   * (ship-force ceremony). When true, ship-phase blockers are recorded on
   * `forcedSurfaces` and do NOT defer the run.
   */
  shipForce?: boolean;
};

const DEFAULT_BUDGET_MS = 5 * 60 * 1000; // spec §5.5 "Normal drain" default

/**
 * Start a quiescence drain. Returns immediately with a runId and an
 * awaitReady() helper that resolves when the coordinator transitions to
 * ready-to-swap (success) or a terminal failure state.
 *
 * The actual orchestration runs in the `ops/quiescence-run` Inngest function
 * (apps/web/lib/queue/functions/quiescence-run.ts); this function only
 * dispatches the start event + creates the audit row.
 *
 * For now, awaitReady is implemented as a DB-polling loop because we don't
 * have a unified "wait for QuiescenceRun status change" primitive. Polling
 * every 2 seconds is fine — quiescence runs are minute-scale operations,
 * not millisecond-scale. BI-QUIESCE-010 may switch to event-driven.
 */
export async function startQuiescence(opts: StartQuiescenceOpts): Promise<{
  runId: string;
  awaitReady: () => Promise<QuiescenceOutcome>;
}> {
  const runId = generateRunId(new Date());
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;

  // We populate initialSnapshot here so the row is always queryable as
  // valid evidence even if the coordinator function fails to start. The
  // coordinator overwrites this immediately on its first step.
  const initialSnapshot = await captureActiveSessionBlockers({
    thresholdMs: budgetMs,
  });

  await prisma.quiescenceRun.create({
    data: {
      runId,
      trigger: opts.trigger,
      triggerRefId: opts.triggerRefId,
      status: "pending",
      enteredStateAt: { pending: new Date().toISOString() } as unknown as object,
      initialSnapshot: initialSnapshot as unknown as object,
      targetVersion: opts.targetVersion,
      targetBundleHash: opts.targetBundleHash,
      budgetMs,
      forcedSurfaces: opts.shipForce
        ? ([{ surface: "ship-force-flag", reason: "operator-pre-authorized", at: new Date().toISOString() }] as unknown as object)
        : ([] as unknown as object),
    },
  });

  const { inngest } = await import("@/lib/queue/inngest-client");
  await inngest.send({
    name: "ops/quiescence.start",
    data: {
      runId,
      budgetMs,
      triggerRefId: opts.triggerRefId ?? null,
      shipForce: !!opts.shipForce,
    },
  });

  return {
    runId,
    awaitReady: () => awaitQuiescenceReady(runId, budgetMs + 60_000),
  };
}

/**
 * Polls QuiescenceRun.status until it reaches `ready-to-swap` or a terminal
 * state. Returns a structured outcome the caller can act on.
 *
 * `outerTimeoutMs` is the absolute ceiling — budget + safety buffer. If
 * exceeded (coordinator crashed silently), returns `failed`.
 */
async function awaitQuiescenceReady(
  runId: string,
  outerTimeoutMs: number,
): Promise<QuiescenceOutcome> {
  const deadline = Date.now() + outerTimeoutMs;
  while (Date.now() < deadline) {
    const row = await prisma.quiescenceRun.findUnique({
      where: { runId },
      select: {
        status: true,
        finalSnapshot: true,
        deferSurface: true,
        outcome: true,
        outcomeNotes: true,
      },
    });
    if (!row) {
      return { ok: false, outcome: "failed", runId, reason: "QuiescenceRun row disappeared" };
    }
    if (row.status === "ready-to-swap") {
      return {
        ok: true,
        outcome: "ready-to-swap",
        runId,
        finalSnapshot: (row.finalSnapshot as unknown as ActiveSessionBlockers) ?? null!,
      };
    }
    if (row.status === "deferred") {
      return {
        ok: false,
        outcome: "deferred",
        runId,
        deferSurface: row.deferSurface,
        finalSnapshot: (row.finalSnapshot as unknown as ActiveSessionBlockers | null) ?? null,
      };
    }
    if (row.status === "aborted" || row.status === "failed") {
      return {
        ok: false,
        outcome: row.status,
        runId,
        reason: row.outcomeNotes ?? `Quiescence ${row.status}`,
      };
    }
    if (row.status === "completed" || row.status === "swapping") {
      // Caller didn't observe ready-to-swap (e.g., another caller raced).
      // Surface as failed so caller doesn't double-swap.
      return { ok: false, outcome: "failed", runId, reason: `Coordinator already ${row.status}` };
    }
    await sleep(2_000);
  }
  return { ok: false, outcome: "failed", runId, reason: "awaitReady outer timeout" };
}

/**
 * Caller signals "I'm about to do the swap" — coordinator records swap window
 * start. Optional convenience for callers that want to distinguish "ready"
 * from "swapping in progress" in the audit trail.
 *
 * No-op if the run is no longer in ready-to-swap status.
 */
export async function signalSwapStarting(runId: string, now: Date = new Date()): Promise<void> {
  await prisma.quiescenceRun.updateMany({
    where: { runId, status: "ready-to-swap" },
    data: { swapStartedAt: now },
  });
}

/**
 * Send a quiescence swap-complete signal with a few quick retries. This event
 * drives the coordinator's terminal transition (completed/failed/aborted) and
 * flips the quiescence level back to normal — losing it leaves the platform
 * draining until the watchdog reaps the coordinator minutes later. A transient
 * inngest.send failure (network blip, rate limit) shouldn't cost that. After the
 * final attempt the error is rethrown so the caller's own failure handling runs.
 */
async function withSwapSignalRetry(
  label: string,
  send: () => Promise<unknown>,
  attempts = 3,
): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await send();
      return;
    } catch (err) {
      lastErr = err;
      // Wrap the full template literal (matches the working
      // agent-coworker.ts / assurance.ts pattern). The printf-with-%s shape
      // splits args across multiple call-edges and CodeQL js/log-injection
      // does not propagate the sanitiser through them — alert #276.
      const errMsg = getErrorMessage(err);
      console.warn(
        sanitizeForLog(`[quiescence] ${label} attempt ${i + 1}/${attempts} failed: ${errMsg}`),
      );
      if (i < attempts - 1) await sleep(500 * (i + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Caller signals "swap succeeded" — triggers the coordinator's terminal
 * success path via Inngest event. The coordinator transitions
 * swapping → completed, flips level to normal, and emits
 * platform.quiescence-cleared to wake suspended Inngest functions.
 */
export async function signalSwapComplete(runId: string): Promise<void> {
  const { inngest } = await import("@/lib/queue/inngest-client");
  await withSwapSignalRetry(`swap-complete(succeeded) ${runId}`, () =>
    inngest.send({
      name: "ops/quiescence.swap-complete",
      data: { runId, outcome: "succeeded" },
    }),
  );
}

/**
 * Caller signals "swap failed" — triggers the coordinator's failure path.
 * Coordinator transitions to failed, flips level to normal (so the system
 * doesn't stay drained), emits platform.quiescence-cleared.
 *
 * Note: this is for swap-itself failures (promoter exit code non-zero,
 * health check failed). It does NOT cover boot-reconcile failures where the
 * new bundle came up but didn't match expected version.
 */
export async function failQuiescenceSwap(runId: string, reason: string): Promise<void> {
  const { inngest } = await import("@/lib/queue/inngest-client");
  await withSwapSignalRetry(`swap-complete(failed) ${runId}`, () =>
    inngest.send({
      name: "ops/quiescence.swap-complete",
      data: { runId, outcome: "failed", reason },
    }),
  );
}

/**
 * Operator-initiated abort from /ops/quiescence UI. Triggers the coordinator's
 * abort path. Coordinator transitions to aborted, flips level to normal,
 * emits platform.quiescence-cleared.
 */
export async function abortQuiescence(runId: string, operatorUserId: string): Promise<void> {
  const { inngest } = await import("@/lib/queue/inngest-client");
  await withSwapSignalRetry(`swap-complete(aborted) ${runId}`, () =>
    inngest.send({
      name: "ops/quiescence.swap-complete",
      data: { runId, outcome: "aborted", operatorUserId },
    }),
  );
}

/**
 * BI-4F3B2FA9 — mid-flight emergency escalation. Promotes an ALREADY-RUNNING
 * drain to forced mode: records who/when on the QuiescenceRun and appends an
 * audit entry to forcedSurfaces. The coordinator's wait loop re-reads
 * shipForceEscalatedAt every tick (see isShipForceEscalated) and treats a
 * non-null value as shipForce, so a stuck drain proceeds to ready-to-swap
 * within one polling interval — without restarting the run.
 *
 * Idempotent (a second call on an already-escalated run is a no-op success).
 * Refuses terminal runs — there is nothing to force once a drain has ended.
 */
export async function escalateQuiescenceToForced(
  runId: string,
  operatorUserId: string,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const row = await prisma.quiescenceRun.findUnique({
    where: { runId },
    select: { status: true, shipForceEscalatedAt: true, forcedSurfaces: true },
  });
  if (!row) return { ok: false, reason: "run not found" };
  if (isTerminalQuiescenceStatus(row.status)) {
    return { ok: false, reason: `run already ${row.status}` };
  }
  if (row.shipForceEscalatedAt) return { ok: true }; // already escalated — no-op

  const prior = Array.isArray(row.forcedSurfaces) ? (row.forcedSurfaces as unknown[]) : [];
  await prisma.quiescenceRun.update({
    where: { runId },
    data: {
      shipForceEscalatedAt: now,
      shipForceEscalatedBy: operatorUserId,
      forcedSurfaces: [
        ...prior,
        {
          surface: "mid-flight-escalation",
          reason: `operator ${operatorUserId} forced an in-flight drain`,
          forcedAt: now.toISOString(),
        },
      ] as unknown as object,
    },
  });
  return { ok: true };
}

/**
 * BI-4F3B2FA9 — hot read of the mid-flight escalation flag, polled by the
 * coordinator each wait tick. True once an operator has clicked "Force Now".
 */
export async function isShipForceEscalated(runId: string): Promise<boolean> {
  const row = await prisma.quiescenceRun.findUnique({
    where: { runId },
    select: { shipForceEscalatedAt: true },
  });
  return !!row?.shipForceEscalatedAt;
}

/**
 * Broadcast a `platform.quiescence-cleared` terminal event from OUTSIDE the
 * coordinator (the boot reconciler). Mirrors quiescence-run.ts:emitCleared:
 * SSE first so any connected operator banner dismisses immediately, then the
 * Inngest event so suspended functions wake. Best-effort on the SSE leg.
 */
async function broadcastQuiescenceCleared(payload: {
  runId: string;
  outcome: "succeeded" | "failed";
  triggerRefId: string | null;
  reason?: string | null;
}): Promise<void> {
  invalidateQuiescenceCache();
  try {
    const { agentEventBus } = await import("@/lib/tak/agent-event-bus");
    agentEventBus.broadcastSystem({
      type: "system:quiescence",
      level: "cleared",
      runId: payload.runId,
      swapEtaSeconds: null,
      deferReason: null,
      deferSurface: null,
      outcome: payload.outcome,
    });
  } catch (err) {
    const msg = getErrorMessage(err);
    console.warn(sanitizeForLog(`[quiescence-reconcile] broadcastSystem failed: ${msg}`));
  }
  const { inngest } = await import("@/lib/queue/inngest-client");
  await inngest.send({
    name: "platform.quiescence-cleared",
    data: {
      runId: payload.runId,
      outcome: payload.outcome,
      triggerRefId: payload.triggerRefId,
      deferSurface: null,
      reason: payload.reason ?? null,
    },
  });
}

/**
 * True when the running bundle is the one this QuiescenceRun was draining
 * toward — i.e. the swap it coordinated actually landed and we booted on its
 * target. A self-upgrade stores the merge/deploy identity in `targetBundleHash`
 * (the upstream lineage marker lives in `targetVersion`, which is NOT the
 * runtime identity), so the deployed SHA is matched against EITHER field to be
 * robust to local-mode rows where they coincide. Case-insensitive; empty
 * fields never match.
 */
export function quiescenceTargetMatchesRunningBundle(
  run: { targetVersion: string | null; targetBundleHash: string | null },
  currentVersion: string | null,
  currentBundleHash: string | null,
): boolean {
  const candidates = [currentVersion, currentBundleHash]
    .filter((s): s is string => !!s)
    .map((s) => s.toLowerCase());
  if (candidates.length === 0) return false;
  const targets = [run.targetVersion, run.targetBundleHash]
    .filter((s): s is string => !!s)
    .map((s) => s.toLowerCase());
  return targets.some((t) => candidates.includes(t));
}

const NON_TERMINAL_QUIESCENCE_STATUSES = QUIESCENCE_RUN_STATUSES.filter(
  (s) => !TERMINAL_QUIESCENCE_STATUSES.has(s),
);

/**
 * Reconcile QuiescenceRun rows on boot (and on a periodic safety tick). The
 * counterpart to instrumentation.ts:reconcileSelfUpgradeRunsOnBoot, closing the
 * SAME self-swap gap for the quiescence coordinator: a real upgrade recreates
 * this very portal, killing the orchestrator before it can deliver the
 * swap-complete handshake — so the coordinator (suspended in Inngest) runs out
 * its full 10-minute `waitForEvent` and falsely records `outcome=failed`, which
 * the operator banner renders as "Upgrade postponed, failed" even though the
 * swap succeeded. The surviving (new) portal closes the loop here.
 *
 * Two cases, both keyed on "are we running this run's target bundle?":
 *
 *  1. In-flight rows (non-terminal status). The coordinator is still suspended
 *     at `waitForEvent`. If we booted on its target, the swap landed → send the
 *     swap-complete signal so the LIVE coordinator finishes through its own
 *     success path (transition completed + flip level normal + emit
 *     quiescence-cleared/succeeded). If we did NOT boot on its target, the swap
 *     never landed → drive the coordinator's failure path so it stops waiting.
 *
 *  2. Already-`failed` rows whose target we ARE running (within `failedLookbackMs`).
 *     The coordinator timed out before this portal booted (slow boot), so its
 *     terminal `failed` is a false negative. Correct it to `completed`
 *     (completionSource='boot-reconciler') and re-emit a truthful
 *     quiescence-cleared/succeeded so the banner is accurate.
 *
 * `staleAfterMs` mirrors the self-upgrade reconciler: 0 (boot default) touches
 * every in-flight row because a boot means any in-flight coordinator is orphaned;
 * >0 (periodic mode) only touches in-flight rows older than the window, so a
 * legitimately in-flight drain on a still-running portal is never reconciled out
 * from under itself. Note the target-match guard already prevents failing a live
 * drain: a drain that has not swapped yet does not match the running bundle.
 *
 * Non-fatal; returns counts. Level normalisation is also handled independently
 * by resetStuckQuiescenceLevelOnBoot, so a throw here never strands the level.
 */
export async function reconcileQuiescenceOnBoot(opts: {
  currentVersion: string | null;
  currentBundleHash: string | null;
  staleAfterMs?: number;
  failedLookbackMs?: number;
  now?: Date;
  logger?: Pick<Console, "log" | "warn" | "error">;
}): Promise<{ reconciled: number; failed: number }> {
  const logger = opts.logger ?? console;
  const now = opts.now ?? new Date();
  const staleAfterMs = opts.staleAfterMs ?? 0;
  const failedLookbackMs = opts.failedLookbackMs ?? 30 * 60 * 1000;

  let reconciled = 0;
  let failed = 0;

  try {
    // ── Case 1: in-flight coordinators orphaned by the swap ──────────────
    const inFlight = await prisma.quiescenceRun.findMany({
      where:
        staleAfterMs > 0
          ? {
              status: { in: [...NON_TERMINAL_QUIESCENCE_STATUSES] },
              startedAt: { lt: new Date(now.getTime() - staleAfterMs) },
            }
          : { status: { in: [...NON_TERMINAL_QUIESCENCE_STATUSES] } },
      select: { runId: true, targetVersion: true, targetBundleHash: true, triggerRefId: true },
    });
    for (const run of inFlight) {
      if (quiescenceTargetMatchesRunningBundle(run, opts.currentVersion, opts.currentBundleHash)) {
        // We booted on this run's target → the swap landed. Complete the
        // handshake the dying portal couldn't: the live coordinator resumes
        // through success and emits quiescence-cleared/succeeded itself.
        await signalSwapComplete(run.runId);
        reconciled++;
        logger.log(
          sanitizeForLog(
            `[quiescence-reconcile] ${run.runId} -> swap-complete (booted on target ${opts.currentVersion ?? "?"})`,
          ),
        );
      } else if (staleAfterMs > 0) {
        // Stale (periodic watchdog) AND not on target → the swap genuinely never
        // landed; the row is orphaned. Fail it.
        await failQuiescenceSwap(
          run.runId,
          `Reconciled by watchdog (stale > ${Math.round(staleAfterMs / 60000)}m): running bundle ${opts.currentBundleHash ?? opts.currentVersion ?? "unknown"} != target ${run.targetBundleHash ?? "unknown"}`,
        );
        failed++;
        logger.log(`[quiescence-reconcile] ${run.runId} -> failed (orphaned, target mismatch)`);
      } else {
        // BOOT pass on a non-target bundle: the swap is PENDING (we may have come
        // up on the pre-upgrade SHA before the promoter recreated the portal on
        // target), not orphaned. Failing here is the false "Upgrade postponed,
        // failed" after a SUCCESSFUL upgrade (BI-3C6447D5). Leave it in-flight —
        // the watchdog above fails it only if it genuinely never lands. Mirrors
        // reconcileSelfUpgradeRunsOnBoot's boot-mode tolerance (instrumentation.ts).
        logger.log(`[quiescence-reconcile] ${run.runId} -> left in-flight (boot; deferring to watchdog)`);
      }
    }

    // ── Case 2: false-negative `failed` rows we actually booted onto ─────
    // The coordinator timed out before this portal came up, so its terminal
    // `failed` is wrong (we are running its target). Correct + re-announce.
    const staleFailed = await prisma.quiescenceRun.findMany({
      where: {
        status: "failed",
        completedAt: { gte: new Date(now.getTime() - failedLookbackMs) },
      },
      select: { runId: true, targetVersion: true, targetBundleHash: true, triggerRefId: true },
    });
    for (const run of staleFailed) {
      if (!quiescenceTargetMatchesRunningBundle(run, opts.currentVersion, opts.currentBundleHash)) {
        continue;
      }
      await transitionState(
        run.runId,
        "completed",
        {
          completedAt: now,
          swapCompletedAt: now,
          outcome: "succeeded",
          completionSource: "boot-reconciler",
          outcomeNotes:
            "Reconciled on boot: swap landed (running bundle matches target); the coordinator had falsely timed out before this portal booted.",
        },
        now,
      );
      await broadcastQuiescenceCleared({
        runId: run.runId,
        outcome: "succeeded",
        triggerRefId: run.triggerRefId,
      });
      reconciled++;
      logger.log(
        sanitizeForLog(`[quiescence-reconcile] ${run.runId} -> corrected failed→completed (false negative)`),
      );
    }

    if (reconciled || failed) {
      logger.log(`[quiescence-reconcile] resolved ${reconciled} reconciled, ${failed} failed`);
    }
    return { reconciled, failed };
  } catch (err) {
    logger.error("[quiescence-reconcile] failed (non-fatal):", err);
    return { reconciled, failed };
  }
}

// ─── Active session blockers — evidence capture ──────────────────────────

/**
 * Spec §5.6 — structured snapshot of what's in flight across all surfaces.
 * Populates parent spec's Layer 1 `activeSessionBlockers` column.
 */
export type ActiveSessionBlockers = {
  capturedAt: string;
  thresholdMs: number;
  totalBlockers: number;
  hardBlockers: number;
  softBlockers: number;
  unobservableSurfaces: string[];
  surfaces: SurfaceBlocker[];
  /**
   * Health verdict on the blocker set (BI-12E24186). Non-null when the capture
   * auto-discounted a provably-empty deliberation loop cohort from the HARD
   * blockers so the drain proceeds on its own. Per the WWMD decision
   * (auto-discount + disclose, never silent), the panel renders this as the
   * hero line so the operator sees a diagnosis — "stuck loop, not live work" —
   * instead of a raw "AI coworker working ×N" that sends them to an empty page.
   */
  verdict?: BlockerVerdict | null;
};

/**
 * A one-line health diagnosis surfaced above the blocker list. Today the only
 * kind is the empty-deliberation-loop (the stub deliberation engine, BI-7B6B3C5C,
 * makes plan gates loop forever producing no output); the shape is left open for
 * future pathological patterns.
 */
export type BlockerVerdict = {
  kind: "empty-deliberation-loop";
  /** How many hard coworker-loop surfaces were reclassified to soft. */
  discountedCount: number;
  /** The builds whose plan deliberations are looping empty. */
  buildIds: string[];
  message: string;
};

export type SurfaceBlocker = {
  surface: string;
  detectionClass: "A" | "B" | "C" | "D" | "E" | "F" | "G";
  kind: "hard" | "soft";
  blockerSignal: BlockerSignal;
  estimatedWaitMs: number | null;
  evidence: Record<string, unknown>;
};

export type BlockerSignal =
  | { class: "A"; model: string; rowId: string; status: string }
  | { class: "B"; model: string; mostRecentAt: string; windowMs: number; count: number }
  | { class: "C"; model: string; rowId: string; lastHeartbeatAt: string; staleAfterMs: number }
  | { class: "D"; functionId: string; runId: string; status: "Running" | "Scheduled"; currentStep?: string }
  | { class: "E"; registry: string; subscriberCount: number; sampleIds?: string[] }
  | { class: "F"; endpoint: string; observation: unknown }
  | { class: "G"; reason: string; mitigations: string[] };

const TOOL_EXECUTION_RECENCY_MS = 5 * 60 * 1000;
const TERMINAL_BUILD_PHASES = ["complete", "failed", "abandoned"] as const;

/**
 * Liveness threshold for dead-phase reaping (admission-control spec §4.4 /
 * BI-17377D05): a non-terminal BuildPhaseRun with completedAt=null whose build
 * shows no active-TaskRun heartbeat AND whose own start is older than this is a
 * corpse — it must not hold the self-upgrade drain open. 15 min with no
 * observable signal.
 *
 * Always-on (no flag). Reaping was originally gated behind
 * QUIESCENCE_REAP_DEAD_PHASES (default OFF) pending load-testing, but the OFF
 * default produced the exact false positive the Self-Upgrade panel exists to
 * prevent. On a live install (2026-06-16) a stalled "build" phase (FB-69231490)
 * — its TaskRun already marked `stalled` by the watchdog, the build quiet for
 * ~6h with zero active TaskRuns — was reported as "a Build Studio build phase
 * was in flight" and skipped every self-upgrade attempt (manual AND scheduled)
 * until an operator forced an override. The leak: a stall/crash never closes the
 * phase's BuildPhaseRun row (only the cost-rollup happy path sets completedAt),
 * and the build's phase stays put, so reconcileTerminalBuildPhaseRuns (which
 * only closes terminal/abandoned/advanced-past builds) leaves the corpse open.
 *
 * The 15-min no-signal window is strictly more conservative than the watchdog's
 * own build-phase stall threshold (180s), so a reaped phase is by construction
 * one the watchdog already considers stalled — reaping can never drop
 * genuinely-live work.
 */
const DEAD_PHASE_LIVENESS_MS = 15 * 60 * 1000;

/**
 * Liveness threshold for dead-COWORKER-LOOP reaping (BI-1C4179D0), the A-class
 * sibling of DEAD_PHASE_LIVENESS_MS. The A-class TaskRun blocker never had the
 * liveness check the BuildPhaseRun path has had since the FB-69231490 fix, so a
 * crashed loop held the drain open forever — surfaced live 2026-07-03 (12 loops,
 * ~60h stale, blocking every manual AND scheduled upgrade). Same 15-min window
 * as the phase path: far longer than the worst-case ~3-min heartbeat interval,
 * and strictly more conservative than the stall watchdog's own heartbeat timeout.
 * Always-on (no flag): the flag-gated watchdog defaulting off was half of why the
 * corpses were never cleared.
 */
const DEAD_COWORKER_LOOP_LIVENESS_MS = 15 * 60 * 1000;

/**
 * Fast-empty-churn detection (BI-12E24186). Distinct from the STALE-loop reaper
 * above: an empty deliberation loop is FRESH — each run heartbeats, completes in
 * under a second producing no branch output (consensusState=insufficient-evidence,
 * the stub deliberation engine BI-7B6B3C5C), and a new one respawns seconds later
 * — so isTaskRunReapable never fires and the loop holds the drain open. The signal
 * is recurrence of empty outcomes on the SAME build inside this window. Zero branch
 * output is the ground truth of "empty", so the detector never discounts a
 * deliberation that actually produced a recommendation, and the minimum-run
 * threshold keeps a single legitimately-inconclusive deliberation from tripping it.
 */
const EMPTY_DELIBERATION_LOOP_WINDOW_MS = 15 * 60 * 1000;
const MIN_EMPTY_RUNS_FOR_LOOP = 3;
const DELIBERATION_TITLE_PREFIX = "Deliberation:";

/**
 * True when an in-flight build phase is a corpse: the most recent observable
 * signal — the build's latest active-TaskRun heartbeat, or the phase's own
 * start if newer — is older than `thresholdMs`. Pure; unit-tested. A live
 * build (recent heartbeat) or a freshly-started phase is never reapable.
 */
export function isBuildPhaseReapable(args: {
  phaseStartedAt: Date;
  buildLastHeartbeatAt: Date | null;
  now: Date;
  thresholdMs: number;
}): boolean {
  const { phaseStartedAt, buildLastHeartbeatAt, now, thresholdMs } = args;
  // phaseStartedAt is always present, so newestSignal never returns null here.
  const lastSignal = newestSignal(buildLastHeartbeatAt, phaseStartedAt);
  return isStale(now, lastSignal, thresholdMs);
}

/**
 * True when a working/active coworker loop (A-class blocker) is provably dead:
 * its newest signal — the last heartbeat, or its start if newer — predates the
 * liveness window. Pure; unit-tested. Sibling to {@link isBuildPhaseReapable}
 * (BI-1C4179D0). `startedAt` is always present on a TaskRun, so a freshly-started
 * loop that has not heartbeated yet is never reaped (startup race protection).
 */
export function isTaskRunReapable(args: {
  startedAt: Date;
  lastHeartbeatAt: Date | null;
  now: Date;
  thresholdMs: number;
}): boolean {
  const { startedAt, lastHeartbeatAt, now, thresholdMs } = args;
  // startedAt is always present, so newestSignal never returns null here.
  const lastSignal = newestSignal(lastHeartbeatAt, startedAt);
  return isStale(now, lastSignal, thresholdMs);
}

/**
 * Repair stale phase-run rows before blocker capture, so quiescence does not
 * report a "Build Studio session in flight" for work that is no longer active.
 * Two classes of orphan, both of which leave completedAt null forever:
 *
 *  (1) the parent build is terminal/abandoned (abandon/fail paths predating
 *      BI-2CC024DB), and
 *  (2) the parent build has ADVANCED PAST this phase — the run's phase no
 *      longer matches the build's current phase. Observed on a live install
 *      (2026-06-16): a "build" phase run sat open for ~6h while its build was
 *      already in "review" (its build task had completed), blocking a
 *      self-upgrade with 0 active TaskRuns. The normal phase-advance path is
 *      expected to close the prior run; this is the always-on safety net for
 *      any advance that doesn't.
 */
export async function reconcileTerminalBuildPhaseRuns(now: Date = new Date()): Promise<number> {
  // (1) Parent build terminal/abandoned — close all its still-open runs.
  const result = await prisma.buildPhaseRun.updateMany({
    where: {
      completedAt: null,
      build: {
        OR: [
          { phase: { in: [...TERMINAL_BUILD_PHASES] } },
          { abandonedAt: { not: null } },
        ],
      },
    },
    data: { completedAt: now },
  });

  // (2) Parent build advanced past this phase. Prisma cannot compare a row
  // column to a related column in updateMany, so close them with one
  // correlated UPDATE (the build provably finished any phase it has left).
  const advanced = await prisma.$executeRaw`
    UPDATE "BuildPhaseRun" AS bpr
    SET "completedAt" = ${now}
    FROM "FeatureBuild" AS fb
    WHERE bpr."buildId" = fb."buildId"
      AND bpr."completedAt" IS NULL
      AND bpr."phase" <> fb."phase"
  `;

  return result.count + advanced;
}

/**
 * Capture a snapshot of every surface that has in-flight work right now.
 *
 * v1 covers A/B-class surfaces (TaskRun status, BuildPhaseRun status,
 * ToolExecution recency proxy) and lists D/E/F/G surfaces as unobservable.
 * Future BIs (003 middleware, 004a Inngest, 005 entry-point gates, 007
 * watchdog extension) add more direct signals as their stop-accept
 * primitives land.
 */
export async function captureActiveSessionBlockers(opts?: {
  thresholdMs?: number;
  now?: Date;
}): Promise<ActiveSessionBlockers> {
  const now = opts?.now ?? new Date();
  const thresholdMs = opts?.thresholdMs ?? TOOL_EXECUTION_RECENCY_MS;
  const surfaces: SurfaceBlocker[] = [];

  await reconcileTerminalBuildPhaseRuns(now);

  // A-class: coworker reasoning loops (TaskRun in working/active)
  const activeTaskRuns = await prisma.taskRun.findMany({
    where: { status: { in: [...TASK_LIVE_STATES] } },
    select: {
      taskRunId: true,
      title: true,
      buildId: true,
      status: true,
      lastHeartbeatAt: true,
      startedAt: true,
      currentAgentId: true,
    },
    take: 25,
  });
  // Dead-loop reaping (always-on, BI-1C4179D0): a working/active TaskRun whose
  // newest signal predates the liveness window is a corpse — a crashed coworker
  // loop that will never heartbeat again — not live work. It must not hold the
  // self-upgrade drain open. Mirrors the BuildPhaseRun corpse reaping below
  // (isBuildPhaseReapable); the A-class path never had this check, so 12 dead
  // loops (60h stale) blocked every drain on a live install (2026-07-03). A
  // reaped row is settled to `stalled` (the watchdog's terminal-for-dead-work
  // state) so the repair is permanent and the loop is surfaced as retryable.
  const reapedTaskRuns: string[] = [];
  for (const row of activeTaskRuns) {
    if (
      isTaskRunReapable({
        startedAt: row.startedAt,
        lastHeartbeatAt: row.lastHeartbeatAt ?? null,
        now,
        thresholdMs: DEAD_COWORKER_LOOP_LIVENESS_MS,
      })
    ) {
      reapedTaskRuns.push(row.taskRunId);
      continue; // corpse — does not block the drain
    }
    surfaces.push({
      surface: "coworker.reasoning-loop",
      detectionClass: "A",
      kind: "hard",
      blockerSignal: { class: "A", model: "TaskRun", rowId: row.taskRunId, status: row.status },
      estimatedWaitMs: 30_000, // typical iteration boundary; worst ~3min
      evidence: {
        taskRunId: row.taskRunId,
        title: row.title,
        buildId: row.buildId,
        status: row.status,
        startedAt: row.startedAt.toISOString(),
        lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
        agentId: row.currentAgentId ?? null,
      },
    });
  }
  if (reapedTaskRuns.length > 0) {
    // Permanently settle the corpses so the same dead loops don't re-trip the
    // blocker capture every tick. Best-effort: a failure here must never break
    // capture (worst case the rows are re-evaluated — and re-excluded — next
    // time). The status guard keeps it idempotent against a concurrent
    // transition (e.g. the stall watchdog racing this capture).
    try {
      await prisma.taskRun.updateMany({
        where: { taskRunId: { in: reapedTaskRuns }, status: { in: [...TASK_LIVE_STATES] } },
        data: { status: "stalled", completedAt: now },
      });
    } catch (err) {
      console.warn("[quiescence] failed to settle reaped dead coworker loop(s):", err);
    }
    console.warn(
      `[quiescence] reaped ${reapedTaskRuns.length} dead coworker loop(s) from the drain (no heartbeat, newest signal > ${DEAD_COWORKER_LOOP_LIVENESS_MS / 60000} min ago). (BI-1C4179D0)`,
    );
  }

  // A-class: BuildPhaseRun in flight (phase mid-execution)
  const inFlightPhases = await prisma.buildPhaseRun.findMany({
    where: {
      completedAt: null,
      build: {
        phase: { notIn: [...TERMINAL_BUILD_PHASES] },
        abandonedAt: null,
      },
    },
    select: { buildId: true, phase: true, startedAt: true },
    take: 25,
  });
  // Dead-phase reaping (always-on): build a buildId → latest active-TaskRun
  // heartbeat map from the TaskRuns already fetched above (no extra query), so a
  // corpse phase (no heartbeat + old start) is dropped from the blockers instead
  // of holding the drain open. A reaped row is ALSO closed (completedAt set)
  // below, so the repair is permanent: the build UI, cost rollups, and the next
  // capture all see a settled phase rather than re-evaluating the same corpse.
  const buildLastHeartbeat = new Map<string, Date>();
  for (const tr of activeTaskRuns) {
    if (!tr.buildId || !tr.lastHeartbeatAt) continue;
    const prev = buildLastHeartbeat.get(tr.buildId);
    if (!prev || tr.lastHeartbeatAt.getTime() > prev.getTime()) {
      buildLastHeartbeat.set(tr.buildId, tr.lastHeartbeatAt);
    }
  }
  const reapedPhases: { buildId: string; phase: string }[] = [];
  for (const row of inFlightPhases) {
    if (
      isBuildPhaseReapable({
        phaseStartedAt: row.startedAt,
        buildLastHeartbeatAt: buildLastHeartbeat.get(row.buildId) ?? null,
        now,
        thresholdMs: DEAD_PHASE_LIVENESS_MS,
      })
    ) {
      reapedPhases.push({ buildId: row.buildId, phase: row.phase });
      continue; // corpse — does not block the drain
    }
    const isShipPhase = row.phase === "ship";
    surfaces.push({
      surface: `build-studio.phase.${row.phase}`,
      detectionClass: "A",
      kind: "hard",
      blockerSignal: {
        class: "A",
        model: "BuildPhaseRun",
        rowId: `${row.buildId}/${row.phase}`,
        status: "in-flight",
      },
      // Phase budgets per spec §6.5
      estimatedWaitMs: phaseBudgetMs(row.phase),
      evidence: {
        buildId: row.buildId,
        phase: row.phase,
        startedAt: row.startedAt.toISOString(),
        shipPhaseShipForceRequired: isShipPhase,
      },
    });
  }
  if (reapedPhases.length > 0) {
    // Permanently settle the corpses so the same dead rows don't re-trip the
    // blocker capture every tick. Best-effort: a failure here must never break
    // blocker capture (worst case the rows are re-evaluated — and re-excluded —
    // next time). The `completedAt: null` guard keeps it idempotent against a
    // concurrent close.
    try {
      await prisma.buildPhaseRun.updateMany({
        where: { completedAt: null, OR: reapedPhases },
        data: { completedAt: now },
      });
    } catch (err) {
      console.warn("[quiescence] failed to close reaped dead build phase(s):", err);
    }
    console.warn(
      `[quiescence] reaped ${reapedPhases.length} dead build phase(s) from the drain (no active heartbeat, started > ${DEAD_PHASE_LIVENESS_MS / 60000} min ago).`,
    );
  }

  // B-class: ToolExecution recency — the existing stopgap signal.
  // Acts as a proxy for "server actions / MCP tool calls were happening
  // recently"; not as authoritative as A/C/D-class direct signals.
  const cutoff = new Date(now.getTime() - thresholdMs);
  // What counts as activity — and, critically, what does NOT (a waiter polling
  // for permission to proceed) — is owned by activity-signal.ts (BI-2C7F51BA).
  const recentToolExecs = await prisma.toolExecution.findMany({
    where: recentActivityWhere(cutoff),
    select: { toolName: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  if (recentToolExecs.length > 0) {
    surfaces.push({
      surface: "request.recent-tool-execution",
      detectionClass: "B",
      kind: "soft",
      blockerSignal: {
        class: "B",
        model: "ToolExecution",
        mostRecentAt: recentToolExecs[0].createdAt.toISOString(),
        windowMs: thresholdMs,
        count: recentToolExecs.length,
      },
      estimatedWaitMs: 30_000, // server action timeout default
      evidence: {
        recentToolNames: recentToolExecs.map((r) => r.toolName),
      },
    });
  }

  // G-class: surfaces we know exist but cannot directly observe.
  // The protocol gates these transitively via upstream entry-point
  // refusals (BI-QUIESCE-005) so they drain naturally as the entry
  // points close. Listed here for operator transparency.
  const unobservableSurfaces: string[] = [
    "mcp.in-flight-tool-call-before-commit",
    "postgres.long-running-transaction",
    "plugin-mcp.held-session",
    "inngest.in-step-execution",
  ];

  // Fast-empty-churn discount (BI-12E24186). A coworker "reasoning loop" that is
  // really a plan deliberation on a build whose recent deliberations all land
  // insufficient-evidence is a stuck EMPTY loop (root cause BI-7B6B3C5C), not live
  // work — and it's FRESH each iteration, so the stale-loop reaper above never
  // catches it. Reclassify those hard surfaces to soft so the drain proceeds, and
  // record a verdict the panel surfaces. Bounded: only queries builds that have a
  // live deliberation loop in this snapshot.
  const loopBuildIds = [
    ...new Set(
      surfaces
        .filter((s) => {
          if (s.surface !== "coworker.reasoning-loop") return false;
          const ev = s.evidence as Record<string, unknown>;
          return (
            typeof ev?.buildId === "string" &&
            typeof ev?.title === "string" &&
            ev.title.startsWith(DELIBERATION_TITLE_PREFIX)
          );
        })
        .map((s) => (s.evidence as Record<string, unknown>).buildId as string),
    ),
  ];
  let verdict: BlockerVerdict | null = null;
  let effectiveSurfaces = surfaces;
  if (loopBuildIds.length > 0) {
    const emptyRunsByBuild = new Map<string, number>();
    try {
      const emptyRuns = await prisma.deliberationRun.findMany({
        where: {
          consensusState: "insufficient-evidence",
          createdAt: { gte: new Date(now.getTime() - EMPTY_DELIBERATION_LOOP_WINDOW_MS) },
          taskRun: { buildId: { in: loopBuildIds } },
        },
        select: { taskRun: { select: { buildId: true } } },
      });
      for (const r of emptyRuns) {
        const b = r.taskRun?.buildId;
        if (b) emptyRunsByBuild.set(b, (emptyRunsByBuild.get(b) ?? 0) + 1);
      }
    } catch (err) {
      // Non-fatal: a failed history read must never break blocker capture. Worst
      // case nothing is discounted and the loop surfaces as a hard blocker (the
      // pre-BI-12E24186 behaviour), which is safe, just noisier.
      console.warn("[quiescence] empty-loop history query failed (non-fatal):", err);
    }
    const discounted = applyEmptyLoopDiscount(surfaces, emptyRunsByBuild);
    effectiveSurfaces = discounted.surfaces;
    verdict = discounted.verdict;
    if (verdict) {
      console.warn(
        `[quiescence] auto-discounted ${verdict.discountedCount} empty deliberation loop(s) on ${verdict.buildIds.length} build(s) from the drain (BI-12E24186).`,
      );
    }
  }

  // Counts derived from the (possibly discounted) surfaces array.
  const totalBlockers = effectiveSurfaces.length;
  const hardBlockers = effectiveSurfaces.filter((s) => s.kind === "hard").length;
  const softBlockers = effectiveSurfaces.filter((s) => s.kind === "soft").length;

  return {
    capturedAt: now.toISOString(),
    thresholdMs,
    totalBlockers,
    hardBlockers,
    softBlockers,
    unobservableSurfaces,
    surfaces: effectiveSurfaces,
    verdict,
  };
}

/**
 * Phase budgets per spec §6.5. ship-phase returns Number.POSITIVE_INFINITY
 * because it's "never force-cancel by default" — coordinator defers unless
 * shipForce override is in play.
 */
export function phaseBudgetMs(phase: string): number {
  switch (phase) {
    case "ideate":
    case "plan":
    case "review":
      return 5 * 60 * 1000;
    case "build":
      return 30 * 60 * 1000;
    case "ship":
      return Number.POSITIVE_INFINITY;
    default:
      return 5 * 60 * 1000;
  }
}

/**
 * Picks the most operator-relevant blocker for a defer event's
 * `deferSurface` field. Heuristic: ship phase > other build phases >
 * coworker loops > everything else.
 */
export function pickPrimaryBlocker(snapshot: ActiveSessionBlockers | null): string | null {
  if (!snapshot || snapshot.surfaces.length === 0) return null;
  const ship = snapshot.surfaces.find((s) => s.surface === "build-studio.phase.ship");
  if (ship) return ship.surface;
  const buildPhase = snapshot.surfaces.find((s) => s.surface.startsWith("build-studio.phase."));
  if (buildPhase) return buildPhase.surface;
  const coworker = snapshot.surfaces.find((s) => s.surface === "coworker.reasoning-loop");
  if (coworker) return coworker.surface;
  return snapshot.surfaces[0].surface;
}

// ─── Operator-facing activity summary (Self-Upgrade panel) ───────────────

/**
 * One aggregated blocker line for the operator panel: a surface name, a
 * human-readable label, how many in-flight items share it, and the worst-case
 * wait. Built by collapsing the raw ActiveSessionBlockers.surfaces list (which
 * has one entry per in-flight item) by surface name.
 */
export type QuiescenceBlockerLine = {
  surface: string;
  label: string;
  kind: "hard" | "soft";
  count: number;
  estimatedWaitMs: number | null;
  /**
   * Operator-facing identity of a representative in-flight item on this surface
   * (BI-D0F4C6FB): the coworker/agent and its task title, so the panel can say
   * WHICH coworker is blocking instead of a bare "AI coworker working". Null for
   * surfaces without a per-item identity (e.g. recent-tool-execution).
   */
  sampleAgent?: string | null;
  sampleTitle?: string | null;
  /** Oldest last-signal (heartbeat, or start if newer) across the collapsed
   *  group, ISO — drives the panel's "last active …" staleness line. */
  oldestSignalAt?: string | null;
  /** True when that oldest signal was already stale past the coworker liveness
   *  window at capture — a corpse the drain auto-reaps (BI-1C4179D0), shown to
   *  the operator as "unresponsive — clears automatically". */
  stale?: boolean;
};

/**
 * Extract a representative operator identity + liveness signal from one raw
 * surface blocker's evidence (BI-D0F4C6FB). Surface-shaped: coworker loops carry
 * agent + title + heartbeat/start; build phases carry a phase name + start;
 * other surfaces have no per-item identity.
 */
function blockerIdentity(s: SurfaceBlocker): {
  agent: string | null;
  title: string | null;
  signalAt: string | null;
} {
  const ev = (s.evidence ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
  if (s.surface === "coworker.reasoning-loop") {
    return {
      agent: str(ev.agentId),
      title: str(ev.title),
      signalAt: newestIso(str(ev.lastHeartbeatAt), str(ev.startedAt)),
    };
  }
  if (s.surface.startsWith("build-studio.phase.")) {
    const phase = str(ev.phase);
    return { agent: null, title: phase ? `${phase} phase` : null, signalAt: str(ev.startedAt) };
  }
  return { agent: null, title: null, signalAt: null };
}

/** The later of two ISO instants (either may be null). */
function newestIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

/** The earlier of two ISO instants (either may be null). */
function oldestIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
}

/**
 * Everything the Self-Upgrade page needs to explain "what's happening" during a
 * drain: the current level, the active QuiescenceRun (if any), and the list of
 * activities currently holding the drain open. Fully serializable.
 */
export type QuiescenceActivity = {
  level: QuiescenceLevel;
  runId: string | null;
  enteredAt: string;
  run: {
    runId: string;
    status: string;
    trigger: string;
    targetVersion: string | null;
    targetBundleHash: string | null;
    deferSurface: string | null;
    deferReason: string | null;
    budgetMs: number | null;
    drainStartedAt: string | null;
    lastHeartbeatAt: string | null;
  } | null;
  /** Capture time of the snapshot the blockers were read from, if any. */
  blockersCapturedAt: string | null;
  blockers: QuiescenceBlockerLine[];
  /** Health verdict for the panel hero line (BI-12E24186); null when nothing was
   *  auto-discounted. */
  verdict?: BlockerVerdict | null;
};

/** Map an internal surface key to a friendly operator label. */
export function describeBlockerSurface(surface: string): string {
  if (surface === "coworker.reasoning-loop") return "AI coworker working";
  if (surface === "request.recent-tool-execution") return "Recent portal / MCP activity";
  if (surface === "build-studio.phase.ship") return "Build Studio — ship phase";
  if (surface.startsWith("build-studio.phase.")) {
    const phase = surface.slice("build-studio.phase.".length);
    return `Build Studio — ${phase} phase`;
  }
  return surface;
}

/**
 * Reclassify provably-empty deliberation-loop coworker surfaces from hard→soft so
 * they stop deferring the drain, and produce a disclosure verdict (BI-12E24186).
 * Pure and unit-tested. `emptyRunsByBuild` is the count of recent
 * insufficient-evidence deliberations per build (gathered by the capture's history
 * query). A coworker surface is discounted only when it is a deliberation loop
 * (title prefix) on a build whose empty-run count meets MIN_EMPTY_RUNS_FOR_LOOP —
 * so genuinely-live coworker work, and a build with a single inconclusive
 * deliberation, are never discounted. Soft blockers do not defer the drain, so
 * the reclassification is exactly the WWMD-chosen "auto-discount"; keeping the
 * surfaces in the list (rather than dropping them) preserves disclosure.
 */
export function applyEmptyLoopDiscount(
  surfaces: SurfaceBlocker[],
  emptyRunsByBuild: Map<string, number>,
): { surfaces: SurfaceBlocker[]; verdict: BlockerVerdict | null } {
  const discountedBuilds = new Set<string>();
  let discountedCount = 0;
  const next = surfaces.map((s) => {
    if (s.surface !== "coworker.reasoning-loop" || s.kind !== "hard") return s;
    const ev = (s.evidence ?? {}) as Record<string, unknown>;
    const title = typeof ev.title === "string" ? ev.title : "";
    const buildId = typeof ev.buildId === "string" ? ev.buildId : null;
    if (!buildId || !title.startsWith(DELIBERATION_TITLE_PREFIX)) return s;
    if ((emptyRunsByBuild.get(buildId) ?? 0) < MIN_EMPTY_RUNS_FOR_LOOP) return s;
    discountedBuilds.add(buildId);
    discountedCount += 1;
    return { ...s, kind: "soft" as const, evidence: { ...ev, emptyLoop: true } };
  });
  if (discountedCount === 0) return { surfaces: next, verdict: null };
  const builds = [...discountedBuilds];
  const runWord = discountedCount === 1 ? "run" : "runs";
  const buildWord = builds.length === 1 ? "build" : "builds";
  const message =
    `${discountedCount} plan deliberation ${runWord} completing empty and looping on ` +
    `${builds.length} ${buildWord} — a stuck loop, not live work. Auto-discounted so the ` +
    `upgrade can proceed. Root cause: the deliberation engine produces no output (BI-7B6B3C5C).`;
  return {
    surfaces: next,
    verdict: { kind: "empty-deliberation-loop", discountedCount, buildIds: builds, message },
  };
}

/** Collapse a raw blockers snapshot into one line per surface, with counts. */
export function summarizeBlockers(
  snapshot: ActiveSessionBlockers | null,
): QuiescenceBlockerLine[] {
  if (!snapshot || !Array.isArray(snapshot.surfaces)) return [];
  const capturedAt = typeof snapshot.capturedAt === "string" ? snapshot.capturedAt : null;
  const bySurface = new Map<string, QuiescenceBlockerLine>();
  for (const s of snapshot.surfaces) {
    const id = blockerIdentity(s);
    const existing = bySurface.get(s.surface);
    if (existing) {
      existing.count += 1;
      existing.estimatedWaitMs = maxWait(existing.estimatedWaitMs, s.estimatedWaitMs);
      // Keep the first identity seen; track the OLDEST (most-stale) signal so the
      // panel surfaces the worst laggard in a collapsed group.
      existing.sampleAgent = existing.sampleAgent ?? id.agent;
      existing.sampleTitle = existing.sampleTitle ?? id.title;
      existing.oldestSignalAt = oldestIso(existing.oldestSignalAt ?? null, id.signalAt);
    } else {
      bySurface.set(s.surface, {
        surface: s.surface,
        label: describeBlockerSurface(s.surface),
        kind: s.kind,
        count: 1,
        estimatedWaitMs: s.estimatedWaitMs,
        sampleAgent: id.agent,
        sampleTitle: id.title,
        oldestSignalAt: id.signalAt,
      });
    }
  }
  // Flag a coworker line as stale when its oldest signal was already past the
  // liveness window at capture — a corpse the drain auto-reaps (BI-1C4179D0).
  for (const line of bySurface.values()) {
    if (line.surface !== "coworker.reasoning-loop" || !line.oldestSignalAt || !capturedAt) continue;
    line.stale =
      new Date(capturedAt).getTime() - new Date(line.oldestSignalAt).getTime() >
      DEAD_COWORKER_LOOP_LIVENESS_MS;
  }
  // Hard blockers first (they're what actually defer the drain), then by count.
  return [...bySurface.values()].sort(
    (a, b) => Number(b.kind === "hard") - Number(a.kind === "hard") || b.count - a.count,
  );
}

function maxWait(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

/**
 * Read the current quiescence activity for the operator panel. Returns the live
 * level plus, when a run is/was active, its target and the activities holding
 * the drain open (from the final snapshot if the run is terminal, else the
 * initial/live snapshot). Never throws on a missing prisma model (fresh boot).
 */
export async function getQuiescenceActivity(now: Date = new Date()): Promise<QuiescenceActivity> {
  const config = await getQuiescenceConfig(now);
  const base: QuiescenceActivity = {
    level: config.level,
    runId: config.runId,
    enteredAt: config.enteredAt,
    run: null,
    blockersCapturedAt: null,
    blockers: [],
    verdict: null,
  };

  if (typeof prisma.quiescenceRun?.findFirst !== "function") return base;

  // Prefer the run named by the live level; otherwise fall back to the most
  // recent run so a just-deferred drain still explains why it backed off.
  const row = config.runId
    ? await prisma.quiescenceRun.findUnique({ where: { runId: config.runId } })
    : await prisma.quiescenceRun.findFirst({ orderBy: { startedAt: "desc" } });
  if (!row) return base;

  const snapshot =
    parseSnapshot(row.finalSnapshot) ?? parseSnapshot(row.initialSnapshot);
  const enteredStateAt =
    (row.enteredStateAt as unknown as EnteredStateAt | null) ?? {};

  return {
    ...base,
    run: {
      runId: row.runId,
      status: row.status,
      trigger: row.trigger,
      targetVersion: row.targetVersion ?? null,
      targetBundleHash: row.targetBundleHash ?? null,
      deferSurface: row.deferSurface ?? null,
      deferReason: row.deferReason ?? null,
      budgetMs: row.budgetMs ?? null,
      drainStartedAt: enteredStateAt.draining ?? null,
      lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    },
    blockersCapturedAt: snapshot?.capturedAt ?? null,
    blockers: summarizeBlockers(snapshot),
    verdict: snapshot?.verdict ?? null,
  };
}

function parseSnapshot(raw: unknown): ActiveSessionBlockers | null {
  if (!raw || typeof raw !== "object") return null;
  const snap = raw as Partial<ActiveSessionBlockers>;
  if (!Array.isArray(snap.surfaces)) return null;
  return snap as ActiveSessionBlockers;
}

// ─── Errors raised by entry-point gates (BI-QUIESCE-005 consumer) ────────

/**
 * Thrown by entry-point gates (spawnWorkThread, startBuildPhaseRun,
 * sandboxPool.acquire, callBrowserUse) when quiescence level is not normal.
 * Caller handlers translate to 503 + Retry-After response or operator-
 * visible "Platform upgrading" message.
 */
export class QuiescingError extends Error {
  readonly code = "PORTAL_QUIESCING";
  readonly retryAfterSeconds: number;
  readonly level: QuiescenceLevel;
  constructor(level: QuiescenceLevel, retryAfterSeconds = 30) {
    super(`Portal is ${level} for upgrade — new work refused`);
    this.name = "QuiescingError";
    this.level = level;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────

function generateRunId(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const suffix = Math.random().toString(36).slice(2, 10);
  return `QR-${y}-${m}-${d}-${suffix}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
