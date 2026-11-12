import "server-only";

import { capabilityDriftFromObservations, capabilityDriftFromReports, type CapabilityDrift } from "./client-capability-drift";
import { credentialKindOf, resolveToolchainVerdict, type ConvergeStatus, type PublishedToolchain, type ToolchainVerdict } from "./toolchain-verdict";

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
  /** The report's extra facts, e.g. the updater's per-client CLI versions (BI-64795FD0). */
  detail?: unknown;
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

type ToolchainObservationClient = {
  agentToolchainObservation: { findMany: (args?: unknown) => Promise<ToolchainObservationRow[]> };
  oAuthClient: { findMany: (args?: unknown) => Promise<Array<{ id: string; registrationKind: string; clientName: string }>> };
  mcpApiToken: { findMany: (args?: unknown) => Promise<Array<{ id: string; kind: string }>> };
};

/** The credential kind behind each `oauth:` / `token:` reference, in two bounded reads. */
async function credentialKindsFor(db: ToolchainObservationClient, refs: string[]): Promise<Map<string, string | null>> {
  const ids = (prefix: string) => [...new Set(refs.filter((ref) => ref.startsWith(prefix)).map((ref) => ref.slice(prefix.length)))];
  const [clients, tokens] = await Promise.all([
    ids("oauth:").length ? db.oAuthClient.findMany({ where: { id: { in: ids("oauth:") } }, select: { id: true, registrationKind: true, clientName: true } }) : [],
    ids("token:").length ? db.mcpApiToken.findMany({ where: { id: { in: ids("token:") } }, select: { id: true, kind: true } }) : [],
  ]);
  const kinds = new Map<string, string | null>();
  for (const client of clients ?? []) kinds.set(`oauth:${client.id}`, credentialKindOf("oauth_access", client));
  for (const token of tokens ?? []) kinds.set(`token:${token.id}`, token.kind);
  return kinds;
}

/**
 * One page of the newest connection observations, rolled up per credential.
 * `capabilityDrift` names each client whose reported version is newer than the
 * capability profile verified ("capabilities unverified for <version>",
 * BI-64795FD0).
 */
export async function getToolchainCopies(
  db: ToolchainObservationClient,
  opts: { published: PublishedToolchain; mcpEndpoint: string; now: Date; staleAfterMs: number; limit?: number },
): Promise<{ credentials: ToolchainCopyRollup[]; truncated: boolean; capabilityDrift: CapabilityDrift[] }> {
  const limit = opts.limit ?? FLEET_PAGE_SIZE;
  const rows = (await db.agentToolchainObservation.findMany({ orderBy: { lastObservedAt: "desc" }, take: limit + 1 })) ?? [];
  const page = rows.slice(0, limit);
  const credentialKinds = await credentialKindsFor(db, page.map((row) => row.credentialRef));
  return {
    credentials: rollUpToolchainCopies(page, { ...opts, credentialKinds }),
    truncated: rows.length > limit,
    capabilityDrift: capabilityDriftFromObservations(page),
  };
}

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
    reportedAt,
  };
  // A heartbeat without detail keeps the last detail: the updater's CLI
  // versions must survive the SessionStart heartbeats between updater runs.
  await db.agentSurfaceReadiness.upsert({
    where: { surfaceKey: input.surfaceKey },
    create: { surfaceKey: input.surfaceKey, ...data, detail: input.detail ?? null },
    update: input.detail === undefined ? data : { ...data, detail: input.detail },
  });
}

/** Default page size for the fleet roll-ups (BI-54469E18: no unbounded reads). */
export const FLEET_PAGE_SIZE = 50;

/** Read the newest surface heartbeats (one page) and roll them up for the fleet view / digest. */
export async function getFleetReadiness(
  db: SurfaceReadinessClient,
  opts: EvaluateFleetReadinessOptions & { limit?: number },
): Promise<FleetReadinessSummary & { truncated: boolean; reportedCapabilityDrift: CapabilityDrift[] }> {
  const limit = opts.limit ?? FLEET_PAGE_SIZE;
  const rows = (await db.agentSurfaceReadiness.findMany({ orderBy: { reportedAt: "desc" }, take: limit + 1 })) ?? [];
  const page = rows.slice(0, limit);
  return {
    ...evaluateFleetReadiness(page, opts),
    truncated: rows.length > limit,
    // BI-64795FD0: CLI versions the updater reported, newer than the profile verified.
    reportedCapabilityDrift: capabilityDriftFromReports(page),
  };
}

// ── Connection-observed toolchain copies (BI-54469E18, design §5.2b) ─────────

export type ToolchainObservationRow = {
  credentialRef: string;
  loadedDigest: string;
  clientKind: string;
  probableClient: string | null;
  loadedPackVersion: string | null;
  authMode: "oauth" | "bearer" | "session";
  clientInfoName: string | null;
  clientInfoVersion: string | null;
  lastObservedAt: Date;
  /** Database form of the host agent's status (underscores), or null when not reported. */
  convergeStatus?: string | null;
  convergeCode?: string | null;
  convergeSince?: Date | null;
};

export type ToolchainCopyRollup = {
  credentialRef: string;
  clientKind: string;
  probableClient: string | null;
  /** Worst verdict among copies seen inside the staleness window. */
  verdict: ToolchainVerdict | "silent";
  copies: Array<{
    loadedPackVersion: string | null;
    loadedDigest: string;
    authMode: ToolchainObservationRow["authMode"];
    verdict: ToolchainVerdict;
    /** Why the verdict is what it is (BI-81AB897A E2: the view used to discard these). */
    reasons: string[];
    silent: boolean;
    lastObservedAt: Date;
    hostAgent: { status: ConvergeStatus; code: string | null; since: Date | null } | null;
  }>;
};

const VERDICT_RANK: Record<ToolchainVerdict, number> = { "below-floor": 3, stale: 2, undeclared: 1, current: 0 };

/** Pure: verdict per observed copy, rolled up per credential. */
export function rollUpToolchainCopies(
  rows: ToolchainObservationRow[],
  opts: {
    published: PublishedToolchain;
    mcpEndpoint: string;
    now: Date;
    staleAfterMs: number;
    /** Credential kind per credentialRef (getToolchainCopies reads it). */
    credentialKinds?: ReadonlyMap<string, string | null>;
  },
): ToolchainCopyRollup[] {
  const cutoff = opts.now.getTime() - opts.staleAfterMs;
  const byCredential = new Map<string, ToolchainCopyRollup>();
  for (const row of rows) {
    const declaration =
      row.loadedDigest !== "undeclared" && row.loadedPackVersion
        ? { pack: row.loadedPackVersion, digest: row.loadedDigest, client: row.clientKind }
        : null;
    const { verdict, reasons } = resolveToolchainVerdict({
      declaration,
      credential: {
        authSource: row.authMode === "oauth" ? "oauth" : row.authMode === "bearer" ? "pat" : "session-jwt",
        credentialKind: opts.credentialKinds?.get(row.credentialRef) ?? null,
      },
      mcpEndpoint: opts.mcpEndpoint,
      published: opts.published,
      now: opts.now,
    });
    const rollup = byCredential.get(row.credentialRef) ?? {
      credentialRef: row.credentialRef,
      clientKind: row.clientKind,
      probableClient: row.probableClient,
      verdict: "silent" as const,
      copies: [],
    };
    const silent = row.lastObservedAt.getTime() < cutoff;
    rollup.copies.push({
      loadedPackVersion: row.loadedPackVersion,
      loadedDigest: row.loadedDigest,
      authMode: row.authMode,
      verdict,
      reasons: verdict === "stale" && reasons.length === 0
        ? ["the files it loaded differ from the released pack"]
        : reasons,
      silent,
      lastObservedAt: row.lastObservedAt,
      hostAgent: row.convergeStatus
        ? { status: row.convergeStatus.replace(/_/g, "-") as ConvergeStatus, code: row.convergeCode ?? null, since: row.convergeSince ?? null }
        : null,
    });
    if (!silent && (rollup.verdict === "silent" || VERDICT_RANK[verdict] > VERDICT_RANK[rollup.verdict])) {
      rollup.verdict = verdict;
    }
    if (rollup.clientKind === "undeclared" && row.clientKind !== "undeclared") rollup.clientKind = row.clientKind;
    byCredential.set(row.credentialRef, rollup);
  }
  return [...byCredential.values()];
}

/** Default staleness window: a surface silent for >7 days is treated as unknown. */
export const DEFAULT_SURFACE_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
