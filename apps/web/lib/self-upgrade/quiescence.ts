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
    where: { status: { in: ["working", "active"] } },
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
 * Caller signals "swap succeeded" — triggers the coordinator's terminal
 * success path via Inngest event. The coordinator transitions
 * swapping → completed, flips level to normal, and emits
 * platform.quiescence-cleared to wake suspended Inngest functions.
 */
export async function signalSwapComplete(runId: string): Promise<void> {
  const { inngest } = await import("@/lib/queue/inngest-client");
  await inngest.send({
    name: "ops/quiescence.swap-complete",
    data: { runId, outcome: "succeeded" },
  });
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
  await inngest.send({
    name: "ops/quiescence.swap-complete",
    data: { runId, outcome: "failed", reason },
  });
}

/**
 * Operator-initiated abort from /ops/quiescence UI. Triggers the coordinator's
 * abort path. Coordinator transitions to aborted, flips level to normal,
 * emits platform.quiescence-cleared.
 */
export async function abortQuiescence(runId: string, operatorUserId: string): Promise<void> {
  const { inngest } = await import("@/lib/queue/inngest-client");
  await inngest.send({
    name: "ops/quiescence.swap-complete",
    data: { runId, outcome: "aborted", operatorUserId },
  });
}

/**
 * Called from app boot (BI-QUIESCE-010 integration). Scans for QuiescenceRun
 * rows that were in flight when the previous bundle died. If the running
 * bundle's version matches `targetVersion`, marks as completed via
 * boot-reconciler. Otherwise marks as failed so caller can decide what to do.
 *
 * Either way, level is forced to normal and platform.quiescence-cleared
 * fires so the new bundle starts in a clean state.
 *
 * BI-QUIESCE-010 wires this into the app startup sequence; v1 is a stub
 * that just returns the candidate runs without action.
 */
export async function reconcileQuiescenceOnBoot(_opts: {
  currentVersion: string;
  currentBundleHash: string;
  now?: Date;
}): Promise<{ reconciled: number; failed: number }> {
  // Stub for BI-QUIESCE-010. Real implementation will:
  //   1. Query QuiescenceRun WHERE status IN (pending, preparing, draining,
  //      ready-to-swap, swapping)
  //   2. Per row: if targetVersion matches currentVersion AND
  //      targetBundleHash matches → transition to completed
  //      (completionSource='boot-reconciler')
  //      Otherwise → transition to failed (completionSource='boot-reconciler')
  //   3. Force level to normal
  //   4. Emit platform.quiescence-cleared for each
  return { reconciled: 0, failed: 0 };
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
const EDGE_AGENT_PREFIX = "edge-node:";
const TERMINAL_BUILD_PHASES = ["complete", "failed", "abandoned"] as const;

/**
 * Repair stale phase-run rows from terminal builds before blocker capture.
 * Abandon/fail paths that predate BI-2CC024DB can leave completedAt null, which
 * otherwise makes quiescence defer forever on work that is no longer active.
 */
export async function reconcileTerminalBuildPhaseRuns(now: Date = new Date()): Promise<number> {
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
  return result.count;
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
    where: { status: { in: ["working", "active"] } },
    select: {
      taskRunId: true,
      title: true,
      buildId: true,
      status: true,
      lastHeartbeatAt: true,
      startedAt: true,
    },
    take: 25,
  });
  for (const row of activeTaskRuns) {
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
      },
    });
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
  for (const row of inFlightPhases) {
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

  // B-class: ToolExecution recency — the existing stopgap signal.
  // Acts as a proxy for "server actions / MCP tool calls were happening
  // recently"; not as authoritative as A/C/D-class direct signals.
  const cutoff = new Date(now.getTime() - thresholdMs);
  const recentToolExecs = await prisma.toolExecution.findMany({
    where: {
      createdAt: { gte: cutoff },
      NOT: { agentId: { startsWith: EDGE_AGENT_PREFIX } },
    },
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

  // Counts derived from surfaces array.
  const totalBlockers = surfaces.length;
  const hardBlockers = surfaces.filter((s) => s.kind === "hard").length;
  const softBlockers = surfaces.filter((s) => s.kind === "soft").length;

  return {
    capturedAt: now.toISOString(),
    thresholdMs,
    totalBlockers,
    hardBlockers,
    softBlockers,
    unobservableSurfaces,
    surfaces,
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
