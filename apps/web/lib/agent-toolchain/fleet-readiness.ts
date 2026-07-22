import "server-only";

// BI-D6DFC0E7 (EP-COMPETENCE-FLYWHEEL, host-agent scope). Make agent-surface
// readiness OBSERVABLE across the fleet, not just self-attested locally.
//
// The bootstrap already COMPUTES a per-surface readiness state
// (computeReadinessState in @dpf/bootstrap/agent-toolchain/readiness-state.ts)
// and persists it to a LOCAL file (.dpf-worktree-readiness.json). Nothing ever
// reports it, so no one can know which surfaces × instances are currently wired
// to durable memory. This module is the report + store + roll-up: a surface
// heartbeats its computed state (via the record_surface_readiness MCP tool), and
// the fleet roll-up feeds the daily digest (the cognitive-load valve, flywheel
// spec §5.5). The evaluator is PURE so the observability logic is unit-tested
// without a live DB.

/**
 * The readiness states a surface reports. Mirrors `ReadinessState` in
 * `@dpf/bootstrap/agent-toolchain/types.ts` (the source of truth) — kept as a
 * local set because @dpf/bootstrap is not an apps/web dependency. Only "ready"
 * is load-bearing here; the rest are carried for display + validation.
 */
export const SURFACE_READINESS_STATES = [
  "ready",
  "partial",
  "missing_cli",
  "missing_token",
  "needs_refresh",
  "portal-unavailable",
  "mcp-unavailable",
  "failed_smoke",
] as const;
export type SurfaceReadinessState = (typeof SURFACE_READINESS_STATES)[number];

export function isSurfaceReadinessState(v: unknown): v is SurfaceReadinessState {
  return typeof v === "string" && (SURFACE_READINESS_STATES as readonly string[]).includes(v);
}

/** The client kinds that report readiness. Build Studio's in-platform Claude is
 *  provisioned separately; it is included so the fleet view is complete. */
export const SURFACE_CLIENT_KINDS = [
  "claude-code",
  "codex",
  "grok",
  "antigravity",
  "build-studio",
] as const;
export type SurfaceClientKind = (typeof SURFACE_CLIENT_KINDS)[number];

export function isSurfaceClientKind(v: unknown): v is SurfaceClientKind {
  return typeof v === "string" && (SURFACE_CLIENT_KINDS as readonly string[]).includes(v);
}

/** One surface's latest heartbeat, as stored/read (the evaluator input shape). */
export interface SurfaceReadinessRow {
  surfaceKey: string;
  clientKind: string;
  readinessState: string;
  dpfPlatformVersion: string | null;
  mcpOk: boolean;
  mcpReason: string | null;
  reportedAt: Date;
}

/** Roll-up status for one surface. `stale` = the heartbeat went silent, so we do
 *  not KNOW it is wired (the honest default — absence is treated as not-ready). */
export type SurfaceRollupStatus = "ready" | "not-ready" | "stale";

export interface SurfaceRollup {
  surfaceKey: string;
  clientKind: string;
  status: SurfaceRollupStatus;
  readinessState: string;
  /** True when an expected version was supplied and this surface is behind it —
   *  a client that updated/reset and has not re-converged. */
  behindVersion: boolean;
  reportedAt: Date;
  mcpOk: boolean;
  mcpReason: string | null;
}

export interface FleetReadinessSummary {
  surfaces: SurfaceRollup[];
  counts: { ready: number; notReady: number; stale: number; total: number };
  /** not-ready + stale — the surfaces the digest should raise. */
  needsAttention: SurfaceRollup[];
  allReady: boolean;
}

export interface EvaluateFleetReadinessOptions {
  now: Date;
  /** A surface whose last heartbeat is older than this is `stale` (unknown). */
  staleAfterMs: number;
  /** Optional: the platform version surfaces should be on; older ⇒ behindVersion. */
  expectedPlatformVersion?: string | null;
}

/**
 * Pure roll-up of surface heartbeats into a fleet readiness summary. Total and
 * deterministic. A silent heartbeat is `stale` (not assumed ready) — the
 * absence-is-stale-not-current invariant (flywheel spec §5, memory-trust P6).
 */
export function evaluateFleetReadiness(
  rows: SurfaceReadinessRow[],
  opts: EvaluateFleetReadinessOptions,
): FleetReadinessSummary {
  const cutoff = opts.now.getTime() - opts.staleAfterMs;
  const expected = opts.expectedPlatformVersion ?? null;

  const surfaces: SurfaceRollup[] = rows.map((r) => {
    const fresh = r.reportedAt.getTime() >= cutoff;
    const status: SurfaceRollupStatus = !fresh
      ? "stale"
      : r.readinessState === "ready"
        ? "ready"
        : "not-ready";
    const behindVersion =
      expected !== null && r.dpfPlatformVersion !== null && r.dpfPlatformVersion !== expected;
    return {
      surfaceKey: r.surfaceKey,
      clientKind: r.clientKind,
      status,
      readinessState: r.readinessState,
      behindVersion,
      reportedAt: r.reportedAt,
      mcpOk: r.mcpOk,
      mcpReason: r.mcpReason,
    };
  });

  const counts = {
    ready: surfaces.filter((s) => s.status === "ready").length,
    notReady: surfaces.filter((s) => s.status === "not-ready").length,
    stale: surfaces.filter((s) => s.status === "stale").length,
    total: surfaces.length,
  };
  const needsAttention = surfaces.filter((s) => s.status !== "ready");

  return {
    surfaces,
    counts,
    needsAttention,
    allReady: surfaces.length > 0 && needsAttention.length === 0,
  };
}

// ── Persistence (thin; the pure evaluator above is the tested core) ──────────

export interface RecordSurfaceReadinessInput {
  surfaceKey: string;
  clientKind: string;
  readinessState: string;
  dpfPlatformVersion?: string | null;
  mcpOk: boolean;
  mcpReason?: string | null;
  detail?: unknown;
  now?: Date;
}

type SurfaceReadinessClient = {
  agentSurfaceReadiness: {
    upsert: (args: unknown) => Promise<unknown>;
    findMany: (args?: unknown) => Promise<SurfaceReadinessRow[]>;
  };
};

/** Upsert a surface's latest heartbeat, keyed by surfaceKey (one row per surface). */
export async function recordSurfaceReadiness(
  db: SurfaceReadinessClient,
  input: RecordSurfaceReadinessInput,
): Promise<void> {
  const reportedAt = input.now ?? new Date();
  const data = {
    clientKind: input.clientKind,
    readinessState: input.readinessState,
    dpfPlatformVersion: input.dpfPlatformVersion ?? null,
    mcpOk: input.mcpOk,
    mcpReason: input.mcpReason ?? null,
    detail: input.detail ?? null,
    reportedAt,
  };
  await db.agentSurfaceReadiness.upsert({
    where: { surfaceKey: input.surfaceKey },
    create: { surfaceKey: input.surfaceKey, ...data },
    update: data,
  });
}

/** Read all surface heartbeats and roll them up for the fleet view / digest. */
export async function getFleetReadiness(
  db: SurfaceReadinessClient,
  opts: EvaluateFleetReadinessOptions,
): Promise<FleetReadinessSummary> {
  const rows = await db.agentSurfaceReadiness.findMany({ orderBy: { reportedAt: "desc" } });
  return evaluateFleetReadiness(rows ?? [], opts);
}

/** Default staleness window: a surface silent for >7 days is treated as unknown. */
export const DEFAULT_SURFACE_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
