/**
 * Plan-limit waits for a Workroom's executor (BI-53BED66C, design
 * docs/superpowers/specs/2026-11-13-t3-code-first-class-executor-design.md D3).
 *
 * On 2026-11-12 Codex ran out of its weekly plan mid-task. DPF already knew —
 * `ProviderCapacityStatus` for `codex` read `quota_resets_at` — but nothing
 * connected that to the room, so it showed only "a token-limited session may
 * return", and after a fixed 24 h grace it would have read as dead and
 * reapable three days before the plan reset.
 *
 * A stated reset is an upper bound, not a promise: providers also reset early,
 * on their own periodic schedule and at random (owner, 2026-11-13). So a wait
 * is "expected back by", any later sign of the executor working supersedes it,
 * and alternatives are offered at once rather than after the reset.
 *
 * Pure: callers load the rows. Nothing here grants authority or moves a room.
 */
import { LEASE_TTL_MS, WORK_CAPSULE_PAUSE_GRACE_MS } from "@/lib/work-capsules";
import { formatInstant } from "@/lib/datetime";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

/** The provider that serves each external executor surface's subscription plan. */
export const EXECUTOR_PLAN_PROVIDER: Readonly<Record<string, string>> = {
  "codex-desktop": "codex",
  "claude-desktop": "anthropic-sub",
  "grok-desktop": "xai",
};
const EXECUTOR_LABEL: Readonly<Record<string, string>> = {
  "codex-desktop": "Codex", "claude-desktop": "Claude", "grok-desktop": "Grok",
};
/** Capacity states that mean the plan cannot serve now and says when it may. */
const LIMIT_STATES = new Set(["quota_resets_at", "rate_limited"]);
/** States that rule a surface out as an alternative, with or without a reset. */
const UNAVAILABLE_STATES = new Set([...LIMIT_STATES, "reauth_required", "billing_action_required"]);
/** A lease renewal this long after a checkpoint's capacity note supersedes it. */
const CHECKPOINT_SUPERSEDED_AFTER_MS = 60_000;

export type ProviderCapacityRow = {
  providerId: string | null;
  state: string;
  retryAt: Date | null;
  lastObservedAt: Date | null;
  lastSuccessAt: Date | null;
};

/** What an executor (or the harness running it) recorded on its heartbeat. */
export type CheckpointCapacity = { provider: string; resetAt: string; note?: string; recordedAt?: string };

export type CapacityAlternative = { executorKind: string; label: string; step: string };
export type CapacityWait = {
  executorKind: string;
  provider: string;
  label: string;
  resetAt: Date;
  source: "provider-capacity" | "executor-checkpoint";
  alternatives: CapacityAlternative[];
};

/**
 * A provider row still says the plan is limited: a later success means an
 * early reset. `holdMs` keeps a room's wait past the reset so its session has
 * the normal grace to come back before the room reads as gone.
 */
function limitedRow(row: ProviderCapacityRow | undefined, now: Date, holdMs = 0): row is ProviderCapacityRow & { retryAt: Date } {
  if (!row || !LIMIT_STATES.has(row.state) || !row.retryAt || row.retryAt.getTime() + holdMs <= now.getTime()) return false;
  return !(row.lastSuccessAt && row.lastObservedAt && row.lastSuccessAt.getTime() > row.lastObservedAt.getTime());
}

function unavailable(row: ProviderCapacityRow | undefined, now: Date): boolean {
  if (!row || !UNAVAILABLE_STATES.has(row.state)) return false;
  if (LIMIT_STATES.has(row.state)) return limitedRow(row, now);
  return true;
}

export function parseCheckpointCapacity(input: unknown): ActionResult<CheckpointCapacity> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return err("capacity must be an object.");
  const raw = input as Record<string, unknown>;
  if (typeof raw.provider !== "string" || !raw.provider.trim() || raw.provider.length > 64) return err("capacity.provider must name the provider.");
  if (typeof raw.resetAt !== "string" || !Number.isFinite(Date.parse(raw.resetAt))) return err("capacity.resetAt must be an ISO time.");
  if (raw.note !== undefined && (typeof raw.note !== "string" || raw.note.length > 300)) return err("capacity.note must be short text.");
  const recordedAt = typeof raw.recordedAt === "string" && Number.isFinite(Date.parse(raw.recordedAt)) ? new Date(raw.recordedAt).toISOString() : undefined;
  return ok({ provider: raw.provider.trim(), resetAt: new Date(raw.resetAt).toISOString(), ...(raw.note ? { note: raw.note as string } : {}), ...(recordedAt ? { recordedAt } : {}) });
}

/**
 * The room's plan-limit wait, or null. A live lease always wins: the executor
 * is evidently working, whatever a provider row says.
 */
export function capacityWaitFor(input: {
  executorKind: string | null;
  leaseExpiresAt: Date | null;
  now: Date;
  providerRows: readonly ProviderCapacityRow[];
  checkpoint?: { capacity?: CheckpointCapacity; recordedAt?: string } | null;
  /** Lower first: estimated cost per unit by executor kind, when the estimator has one. */
  costRank?: Readonly<Record<string, number>>;
  /** How long past the reset the room keeps waiting for its session (the liveness pause grace). */
  graceMs?: number;
}): CapacityWait | null {
  const { executorKind, leaseExpiresAt, now } = input;
  const graceMs = input.graceMs ?? WORK_CAPSULE_PAUSE_GRACE_MS;
  if (!executorKind || !EXECUTOR_PLAN_PROVIDER[executorKind]) return null;
  if (leaseExpiresAt && leaseExpiresAt.getTime() > now.getTime()) return null;
  const byProvider = new Map(input.providerRows.filter((row) => row.providerId).map((row) => [row.providerId as string, row]));
  const provider = EXECUTOR_PLAN_PROVIDER[executorKind];

  let wait: Pick<CapacityWait, "provider" | "resetAt" | "source"> | null = null;
  const noted = input.checkpoint?.capacity;
  const notedAtText = noted?.recordedAt ?? input.checkpoint?.recordedAt;
  const notedAt = notedAtText ? Date.parse(notedAtText) : NaN;
  const lastRenewal = leaseExpiresAt ? leaseExpiresAt.getTime() - LEASE_TTL_MS : NaN;
  if (noted && Number.isFinite(notedAt) && Date.parse(noted.resetAt) + graceMs > now.getTime()
    && !(Number.isFinite(lastRenewal) && lastRenewal > notedAt + CHECKPOINT_SUPERSEDED_AFTER_MS)) {
    wait = { provider: noted.provider, resetAt: new Date(noted.resetAt), source: "executor-checkpoint" };
  }
  const row = byProvider.get(provider);
  if (!wait && limitedRow(row, now, graceMs)) wait = { provider, resetAt: row.retryAt, source: "provider-capacity" };
  if (!wait) return null;

  const alternatives = Object.keys(EXECUTOR_PLAN_PROVIDER)
    .filter((kind) => kind !== executorKind && !unavailable(byProvider.get(EXECUTOR_PLAN_PROVIDER[kind]), now))
    .sort((a, b) => (input.costRank?.[a] ?? Number.MAX_SAFE_INTEGER) - (input.costRank?.[b] ?? Number.MAX_SAFE_INTEGER))
    .map((kind) => ({
      executorKind: kind,
      label: EXECUTOR_LABEL[kind],
      step: `reassign_workroom_executor phase "request" to ${kind}; the receiving ${EXECUTOR_LABEL[kind]} session acknowledges. Same owner and scope, so no approval.`,
    }));
  return { executorKind, label: EXECUTOR_LABEL[executorKind], ...wait, alternatives };
}

/**
 * The owner reads times in US Central (owner direction). The shared formatter
 * keeps the viewer's locale and appends the zone label, e.g. "CST".
 */
export function formatCentral(at: Date): string {
  return formatInstant(at, { timeZone: "America/Chicago", withZone: true,
    options: { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" } });
}

export function describeCapacityWait(wait: Pick<CapacityWait, "label" | "resetAt" | "alternatives">, now: Date = new Date()): string {
  const alternatives = wait.alternatives.length
    ? ` ${wait.alternatives.map((entry) => entry.label).join(" or ")} can take it over now.`
    : " No other executor is available now.";
  if (wait.resetAt.getTime() <= now.getTime()) {
    return `${wait.label} plan reset at ${formatCentral(wait.resetAt)}; waiting for the session to resume.${alternatives}`;
  }
  return `${wait.label} plan limit reached; expected back by ${formatCentral(wait.resetAt)} (may return sooner; rechecked hourly).${alternatives}`;
}

/** The latest checkpoint the room kept, if it carries a capacity note. */
export function checkpointOf(workspaceState: unknown): { capacity?: CheckpointCapacity; recordedAt?: string } | null {
  if (!workspaceState || typeof workspaceState !== "object" || Array.isArray(workspaceState)) return null;
  const checkpoint = (workspaceState as Record<string, unknown>).executorCheckpoint;
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) return null;
  const record = checkpoint as Record<string, unknown>;
  const capacity = record.capacity ? parseCheckpointCapacity(record.capacity) : null;
  return {
    ...(capacity?.ok ? { capacity: capacity.data } : {}),
    ...(typeof record.recordedAt === "string" ? { recordedAt: record.recordedAt } : {}),
  };
}

type CapacityReader = { providerCapacityStatus?: { findMany(args: unknown): Promise<ProviderCapacityRow[]> } };

/** One read for a page of rooms. A missing table or a failed read means "no wait known". */
export async function loadProviderCapacityRows(db: CapacityReader): Promise<ProviderCapacityRow[]> {
  if (!db.providerCapacityStatus) return [];
  return db.providerCapacityStatus.findMany({
    where: { providerId: { in: Object.values(EXECUTOR_PLAN_PROVIDER) } },
    select: { providerId: true, state: true, retryAt: true, lastObservedAt: true, lastSuccessAt: true },
  }).catch(() => []);
}

const PLAN_LIMIT_TEXT = /\b(usage|rate|plan|weekly|daily)\s+limit\b|\bquota\b|\bhit your\b.*\blimit\b/i;
const RUNTIME_PLAN_PROVIDER: Readonly<Record<string, string>> = { codex: "codex", claude: "anthropic-sub" };

/**
 * A supervised runtime turn failed: was it the plan's usage limit, and when
 * does the provider say access returns? Null when the failure is anything else.
 * A limit with no parseable reset still returns, with `resetAt` null, so the
 * room can say so; the platform's capacity row may know the time.
 */
export function runtimePlanLimit(
  runtimeProvider: string, error: string | null | undefined, now: Date,
  parseReset: (text: string, now: Date) => Date | null,
): { provider: string; resetAt: Date | null } | null {
  const provider = RUNTIME_PLAN_PROVIDER[runtimeProvider];
  if (!provider || !error || !PLAN_LIMIT_TEXT.test(error)) return null;
  const resetAt = parseReset(error, now);
  return { provider, resetAt: resetAt && resetAt.getTime() > now.getTime() ? resetAt : null };
}
