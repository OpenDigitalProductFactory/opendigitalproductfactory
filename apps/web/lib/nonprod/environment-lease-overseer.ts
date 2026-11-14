// BI-218A4555: the test-machine overseer (design
// docs/superpowers/specs/2026-11-12-test-machine-overseer-design.md, decision
// DI-2C6093E878DC).
//
// Pure policy for shared nonproduction leases. The admission planner orders
// waiters with it, renewal bounds holds with it, and every reader that shows a
// queue position explains it with it. Nothing here touches the database: the
// callers already hold the environment advisory lock and pass the rows in.
//
// Shared test machines were first-come and self-renewing, so one aggressive
// session could hold a slot for hours and re-take it the moment it let go,
// while gates and local AI reviews waited. Order is now set by policy, never
// by who claimed first or renews fastest:
//
//   1. effective tier   gates and AI turns, then verification, then previews;
//                       every 30 minutes waited lifts a waiter one tier.
//   2. class turn       in tier 0, gates and AI turns alternate.
//   3. virtual start    a session (and its executor) that was just served
//                       waits a bounded extra time, so it cannot re-take a
//                       slot ahead of others and cannot be starved either.
//   4. queuedAt, id.

export const OVERSEER_POLICY_VERSION = "overseer.v1";

export type HoldClass =
  | "gate"
  | "ai-turn"
  | "verification"
  | "check"
  | "preview"
  | "candidate";

export type LeaseClassification = {
  holdClass: HoldClass;
  tier: 0 | 1 | 2;
  /** Longest a hold may last while another session waits; null = unbounded. */
  holdBoundMs: number | null;
};

/** Every 30 minutes waited lifts a waiter one tier (AC-OVS-2). */
export const TIER_AGING_MS = 30 * 60_000;
/** How far back admissions count as recent service (fair share, class turn). */
export const SERVICE_LOOKBACK_MS = 60 * 60_000;
/** Extra wait for a session that was served within the lookback (AC-OVS-3). */
export const SESSION_FAIR_SHARE_MS = 10 * 60_000;
/** Extra wait for an executor (claude, codex, …) served within the lookback. */
export const EXECUTOR_FAIR_SHARE_MS = 2 * 60_000;
/**
 * A local AI turn proves liveness for this long after its last deferral. It
 * must exceed the 5-minute ceiling of the review capacity recheck
 * (capacityRecoveryMarker), or a waiting review would never hold its turn.
 */
export const AI_TURN_LIVENESS_MS = 6 * 60_000;
/** An AI turn row nobody refreshes is reaped by expiry after this. */
export const AI_TURN_TTL_MS = 10 * 60_000;
export const AI_TURN_CLAIM_PREFIX = "inference-turn:";

const MINUTE = 60_000;

/** Bounds sit above each class's observed p95 hold (14-day read, 2026-11-12). */
export const CLASS_HOLD_BOUND_MS: Readonly<Record<HoldClass, number | null>> = Object.freeze({
  gate: 30 * MINUTE, // p95 9 min, max 12 min
  "ai-turn": 45 * MINUTE,
  verification: 45 * MINUTE, // observed outliers at 151 and 175 min
  check: 45 * MINUTE, // host vitest/typescript p95 27–34 min
  preview: 20 * MINUTE, // BI-995E9530, unchanged
  candidate: null,
});

/** Used for wait estimates when the last hour has no completed hold of a class. */
export const CLASS_TYPICAL_HOLD_MS: Readonly<Record<HoldClass, number>> = Object.freeze({
  gate: 4 * MINUTE,
  "ai-turn": 3 * MINUTE,
  verification: 25 * MINUTE,
  check: 5 * MINUTE,
  preview: 20 * MINUTE,
  candidate: 10 * MINUTE,
});

const CLASS_LABEL: Readonly<Record<HoldClass, string>> = Object.freeze({
  gate: "gate",
  "ai-turn": "AI review turn",
  verification: "verification run",
  check: "check",
  preview: "preview",
  candidate: "candidate",
});

export type OverseerLease = {
  id: string;
  environmentKey?: string | null;
  status: string;
  claimKey?: string | null;
  resourceClass?: string | null;
  ownerSessionId?: string | null;
  ownerProvider?: string | null;
  queuedAt?: Date | null;
  admittedAt?: Date | null;
  releasedAt?: Date | null;
  heartbeatAt?: Date | null;
  expiresAt?: Date | null;
};

function startsWithAny(value: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

export function isAiTurnClaimKey(claimKey: string | null | undefined): boolean {
  return (claimKey ?? "").startsWith(AI_TURN_CLAIM_PREFIX);
}

function classified(holdClass: HoldClass, tier: 0 | 1 | 2): LeaseClassification {
  return { holdClass, tier, holdBoundMs: CLASS_HOLD_BOUND_MS[holdClass] };
}

/**
 * The lease's class, derived on the server from columns the client cannot use
 * to buy priority: a claim key prefix is how the lane identifies itself, and
 * every lane already uses exactly one.
 */
export function classifyLease(lease: Pick<OverseerLease, "environmentKey" | "claimKey" | "resourceClass">): LeaseClassification {
  const claimKey = lease.claimKey ?? "";
  if (lease.environmentKey === "host-heavy-resource") {
    const resourceClass = lease.resourceClass ?? "";
    if (resourceClass === "semantic-review" || resourceClass === "inference") return classified("ai-turn", 0);
    if (resourceClass === "preview") return classified("preview", 2);
    return classified("check", 1);
  }
  if (lease.environmentKey === "active-candidate") return classified("candidate", 0);
  if (startsWithAny(claimKey, ["gate:", "local-ci:"])) return classified("gate", 0);
  if (isAiTurnClaimKey(claimKey)) return classified("ai-turn", 0);
  if (claimKey.startsWith("dev-portal:")) return classified("preview", 2);
  return classified("verification", 1);
}

/** Environments whose order stays first-come (design: active-candidate unchanged). */
export function environmentUsesOverseer(environmentKey: string | null | undefined): boolean {
  return environmentKey !== "active-candidate";
}

export type ServiceHistory = {
  now: number;
  lastServedBySession: Map<string, number>;
  lastServedByExecutor: Map<string, number>;
  lastAdmittedByClass: Map<HoldClass, number>;
  /** Completed hold durations by class within the lookback, for estimates. */
  completedHoldsByClass: Map<HoldClass, number[]>;
};

/**
 * Recent service, read from rows the caller already loaded: admissions in the
 * lookback, and holds still running (which count as served now).
 */
export function buildServiceHistory(rows: readonly OverseerLease[], now: Date): ServiceHistory {
  const nowMs = now.getTime();
  const since = nowMs - SERVICE_LOOKBACK_MS;
  const history: ServiceHistory = {
    now: nowMs,
    lastServedBySession: new Map(),
    lastServedByExecutor: new Map(),
    lastAdmittedByClass: new Map(),
    completedHoldsByClass: new Map(),
  };
  const seen = new Set<string>();
  const bump = <K>(map: Map<K, number>, key: K | null | undefined, at: number) => {
    if (key === null || key === undefined || key === "") return;
    map.set(key, Math.max(map.get(key) ?? Number.NEGATIVE_INFINITY, at));
  };
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const admitted = row.admittedAt?.getTime();
    if (admitted === undefined || !Number.isFinite(admitted)) continue;
    const holding = row.status === "active" && (row.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY) > nowMs;
    if (!holding && admitted < since) continue;
    const { holdClass } = classifyLease(row);
    bump(history.lastAdmittedByClass, holdClass, admitted);
    const servedAt = holding ? nowMs : Math.max(admitted, row.releasedAt?.getTime() ?? admitted);
    // An AI turn row is owned by the platform, not by a session.
    if (holdClass !== "ai-turn") {
      bump(history.lastServedBySession, row.ownerSessionId, servedAt);
      bump(history.lastServedByExecutor, row.ownerProvider, servedAt);
    }
    const released = row.releasedAt?.getTime();
    if (!holding && released !== undefined && released >= admitted) {
      const list = history.completedHoldsByClass.get(holdClass) ?? [];
      list.push(released - admitted);
      history.completedHoldsByClass.set(holdClass, list);
    }
  }
  return history;
}

function queuedMs(lease: OverseerLease): number {
  return lease.queuedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

export function effectiveTier(lease: OverseerLease, now: number): number {
  const { tier } = classifyLease(lease);
  const waited = Math.max(0, now - queuedMs(lease));
  return Math.max(0, tier - Math.floor(waited / TIER_AGING_MS));
}

/**
 * When the waiter is treated as having arrived. A session served recently is
 * treated as arriving a bounded time after that service, never earlier than it
 * really queued — so the discount is at most SESSION_FAIR_SHARE_MS past its
 * own queue time, and age still wins in the end.
 */
export function virtualStartMs(lease: OverseerLease, history: ServiceHistory): number {
  const queued = queuedMs(lease);
  if (isAiTurnClaimKey(lease.claimKey)) return queued;
  const session = lease.ownerSessionId ? history.lastServedBySession.get(lease.ownerSessionId) : undefined;
  const executor = lease.ownerProvider ? history.lastServedByExecutor.get(lease.ownerProvider) : undefined;
  return Math.max(
    queued,
    session === undefined ? Number.NEGATIVE_INFINITY : session + SESSION_FAIR_SHARE_MS,
    executor === undefined ? Number.NEGATIVE_INFINITY : executor + EXECUTOR_FAIR_SHARE_MS,
  );
}

function classTurnRank(lease: OverseerLease, history: ServiceHistory): number {
  const last = history.lastAdmittedByClass.get(classifyLease(lease).holdClass);
  return last === undefined ? Number.NEGATIVE_INFINITY : last;
}

export function compareByPolicy(left: OverseerLease, right: OverseerLease, history: ServiceHistory): number {
  const now = history.now;
  const tierDelta = effectiveTier(left, now) - effectiveTier(right, now);
  if (tierDelta !== 0) return tierDelta;
  if (effectiveTier(left, now) === 0) {
    const leftClass = classifyLease(left).holdClass;
    const rightClass = classifyLease(right).holdClass;
    if (leftClass !== rightClass) {
      // The class admitted least recently goes first; never admitted ranks first.
      const leftLast = classTurnRank(left, history);
      const rightLast = classTurnRank(right, history);
      if (leftLast !== rightLast) return leftLast < rightLast ? -1 : 1;
    }
  }
  const virtualDelta = virtualStartMs(left, history) - virtualStartMs(right, history);
  if (virtualDelta !== 0) return virtualDelta;
  return queuedMs(left) - queuedMs(right) || left.id.localeCompare(right.id);
}

function compareFifo(left: OverseerLease, right: OverseerLease): number {
  return queuedMs(left) - queuedMs(right) || left.id.localeCompare(right.id);
}

/** Waiters in the order the overseer serves them. */
export function orderWaiters<T extends OverseerLease>(
  waiters: readonly T[],
  history: ServiceHistory,
  environmentKey?: string | null,
): T[] {
  const environment = environmentKey ?? waiters[0]?.environmentKey;
  const comparator = environmentUsesOverseer(environment)
    ? (left: T, right: T) => compareByPolicy(left, right, history)
    : compareFifo;
  return [...waiters].sort(comparator);
}

/** Proof-of-life window for a waiter: an AI turn has its own, longer one. */
export function waiterLivenessWindowMs(
  lease: Pick<OverseerLease, "claimKey">,
  defaultWindowMs: number | undefined,
): number | undefined {
  if (isAiTurnClaimKey(lease.claimKey)) return AI_TURN_LIVENESS_MS;
  return defaultWindowMs;
}

export function waiterIsLive(lease: OverseerLease, now: number, defaultWindowMs: number): boolean {
  const window = waiterLivenessWindowMs(lease, defaultWindowMs) ?? defaultWindowMs;
  const lastBeat = lease.heartbeatAt ?? lease.queuedAt ?? null;
  if (!lastBeat) return false;
  if (lease.expiresAt && lease.expiresAt.getTime() <= now) return false;
  return now - lastBeat.getTime() <= window;
}

export type HoldBoundDecision =
  | { kind: "unbounded"; classification: LeaseClassification; contended: boolean }
  | { kind: "within-bound"; classification: LeaseClassification; contended: boolean; holdBoundAt: Date }
  | { kind: "yield"; classification: LeaseClassification; contended: true; holdBoundAt: Date; phase: string };

/**
 * May this hold be renewed, and until when (AC-OVS-5, AC-OVS-6)?
 *
 * Contended means a waiter in the same environment that proves it is alive and
 * belongs to another session. A session's own queued claim, or a dead row, is
 * not someone waiting.
 */
export function decideHoldBound(input: {
  holder: OverseerLease;
  waiters: readonly OverseerLease[];
  now: Date;
  waiterLivenessWindowMs: number;
}): HoldBoundDecision {
  const classification = classifyLease(input.holder);
  const nowMs = input.now.getTime();
  const contended = input.waiters.some((waiter) =>
    waiter.status === "queued"
    && waiter.id !== input.holder.id
    && (waiter.ownerSessionId ?? null) !== (input.holder.ownerSessionId ?? null)
    && waiterIsLive(waiter, nowMs, input.waiterLivenessWindowMs));
  const admitted = input.holder.admittedAt?.getTime();
  if (classification.holdBoundMs === null || admitted === undefined || !Number.isFinite(admitted)) {
    return { kind: "unbounded", classification, contended };
  }
  const holdBoundAt = new Date(admitted + classification.holdBoundMs);
  if (contended && nowMs >= holdBoundAt.getTime()) {
    return {
      kind: "yield",
      classification,
      contended: true,
      holdBoundAt,
      phase: `yielded:${classification.holdClass}:hold-bound`,
    };
  }
  return { kind: "within-bound", classification, contended, holdBoundAt };
}

/** Renewal expiry: never past the class bound while someone else waits. */
export function boundedRenewalExpiry(decision: HoldBoundDecision, requested: Date): Date {
  if (decision.kind !== "within-bound" || !decision.contended) return requested;
  return new Date(Math.min(requested.getTime(), decision.holdBoundAt.getTime()));
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export function typicalHoldMs(holdClass: HoldClass, history: ServiceHistory): number {
  return median(history.completedHoldsByClass.get(holdClass) ?? []) ?? CLASS_TYPICAL_HOLD_MS[holdClass];
}

export type QueueExplanation = {
  leaseId: string;
  queuePosition: number;
  holdClass: HoldClass;
  estimatedWaitMs: number;
  queueReason: string;
  policyVersion: typeof OVERSEER_POLICY_VERSION;
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function describeAhead(ahead: readonly OverseerLease[]): string {
  const counts = new Map<HoldClass, number>();
  for (const lease of ahead) {
    const { holdClass } = classifyLease(lease);
    counts.set(holdClass, (counts.get(holdClass) ?? 0) + 1);
  }
  return [...counts.entries()].map(([holdClass, count]) => plural(count, CLASS_LABEL[holdClass])).join(", ");
}

function whyThisPosition(lease: OverseerLease, ahead: readonly OverseerLease[], history: ServiceHistory): string {
  const notes: string[] = [];
  const own = classifyLease(lease);
  if (own.tier > 0 && ahead.some((other) => effectiveTier(other, history.now) < effectiveTier(lease, history.now))) {
    notes.push(`gates and AI review turns go before a ${CLASS_LABEL[own.holdClass]}; waiting lifts it one step every 30 minutes`);
  }
  if (ahead.some((other) => classifyLease(other).holdClass !== own.holdClass && effectiveTier(other, history.now) === 0)
    && effectiveTier(lease, history.now) === 0) {
    notes.push("gates and AI review turns take turns");
  }
  if (virtualStartMs(lease, history) > queuedMs(lease)) {
    notes.push("this session or its executor was served recently, so others go first for a short while");
  }
  return notes.length > 0 ? ` (${notes.join("; ")})` : "";
}

/**
 * Position, estimate and a one-sentence reason for every waiter (AC-OVS-7).
 *
 * The estimate is the shortest remaining active hold when no slot is free, plus
 * the typical hold of everyone ahead spread across the capacity. It is an
 * estimate, and says so in its field name.
 */
export function explainQueue(input: {
  ordered: readonly OverseerLease[];
  active: readonly OverseerLease[];
  capacity: number;
  history: ServiceHistory;
  waiterLivenessWindowMs: number;
}): QueueExplanation[] {
  const nowMs = input.history.now;
  const capacity = Math.max(1, input.capacity);
  const remaining = input.active.map((holder) => {
    const { holdClass } = classifyLease(holder);
    const admitted = holder.admittedAt?.getTime() ?? nowMs;
    const typicalLeft = Math.max(0, admitted + typicalHoldMs(holdClass, input.history) - nowMs);
    const decision = decideHoldBound({
      holder,
      waiters: input.ordered,
      now: new Date(nowMs),
      waiterLivenessWindowMs: input.waiterLivenessWindowMs,
    });
    const boundLeft = decision.kind === "unbounded" || !decision.contended
      ? Number.POSITIVE_INFINITY
      : Math.max(0, decision.holdBoundAt.getTime() - nowMs);
    return Math.min(typicalLeft, boundLeft);
  });
  const freeSlots = Math.max(0, capacity - input.active.length);
  const firstFree = freeSlots > 0 || remaining.length === 0 ? 0 : Math.min(...remaining);
  let aheadWork = 0;
  return input.ordered.map((lease, index) => {
    const ahead = input.ordered.slice(0, index);
    const estimatedWaitMs = Math.round(firstFree + aheadWork / capacity);
    aheadWork += typicalHoldMs(classifyLease(lease).holdClass, input.history);
    const aheadText = ahead.length === 0
      ? "next in line"
      : `${ahead.length} ahead: ${describeAhead(ahead)}`;
    return {
      leaseId: lease.id,
      queuePosition: index + 1,
      holdClass: classifyLease(lease).holdClass,
      estimatedWaitMs,
      queueReason: `${aheadText}${whyThisPosition(lease, ahead, input.history)}.`,
      policyVersion: OVERSEER_POLICY_VERSION,
    };
  });
}
