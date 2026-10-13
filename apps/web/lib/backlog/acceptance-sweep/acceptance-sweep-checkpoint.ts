/** Acceptance-only state stored within ScheduledAgentTask.taskConfig (BI-E3B918C2).
 * Pure transitions; callers must serialize reads and writes on the task row.
 */
export const SWEEP_LEASE_MS = 5 * 60_000;
export type SweepUpgrade = { runId: string; completedAt: string; rowId: string };
export type SweepClaim = { token: string; runId: string | null };
export type SweepCheckpoint = {
  schemaVersion: 1;
  latest: SweepUpgrade | null;
  pending: SweepUpgrade | null;
  acknowledgedRunId: string | null;
  owner: (SweepClaim & { expiresAt: number }) | null;
};

export function emptySweepCheckpoint(): SweepCheckpoint {
  return { schemaVersion: 1, latest: null, pending: null, acknowledgedRunId: null, owner: null };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function upgrade(value: unknown): value is SweepUpgrade {
  return object(value) && text(value.runId) && text(value.rowId)
    && text(value.completedAt) && Number.isFinite(Date.parse(value.completedAt));
}

export function readSweepCheckpoint(config: unknown): SweepCheckpoint {
  if (config === null || config === undefined) return emptySweepCheckpoint();
  if (!object(config)) throw new Error("Malformed acceptance sweep checkpoint");
  if (!("acceptanceSweep" in config)) return emptySweepCheckpoint();
  const value = config.acceptanceSweep;
  if (!object(value) || value.schemaVersion !== 1
    || !(value.latest === null || upgrade(value.latest))
    || !(value.pending === null || upgrade(value.pending))
    || !(value.acknowledgedRunId === null || text(value.acknowledgedRunId))
    || !(value.owner === null || (object(value.owner) && text(value.owner.token)
      && (value.owner.runId === null || text(value.owner.runId))
      && typeof value.owner.expiresAt === "number" && Number.isFinite(value.owner.expiresAt)))) {
    throw new Error("Malformed acceptance sweep checkpoint");
  }
  if (value.pending !== null && (value.latest === null || value.pending.runId !== value.latest.runId)) {
    throw new Error("Malformed acceptance sweep checkpoint");
  }
  return value as SweepCheckpoint;
}

export function observeUpgrade(state: SweepCheckpoint, observed: SweepUpgrade): SweepCheckpoint {
  if (!upgrade(observed)) throw new Error("Invalid acceptance upgrade identity");
  if (state.latest) {
    const order = Date.parse(observed.completedAt) - Date.parse(state.latest.completedAt)
      || observed.rowId.localeCompare(state.latest.rowId);
    if (order <= 0 || state.latest.runId === observed.runId) return state;
  }
  return { ...state, latest: observed, pending: observed };
}

export function claimSweep(state: SweepCheckpoint, token: string, now: number): { checkpoint: SweepCheckpoint; claim: SweepClaim } {
  if (!text(token) || !Number.isFinite(now)) throw new Error("Invalid acceptance sweep claim");
  if (state.owner && state.owner.expiresAt > now) throw new Error("Acceptance sweep already owned");
  const claim = { token, runId: state.pending?.runId ?? null };
  return { claim, checkpoint: { ...state, owner: { ...claim, expiresAt: now + SWEEP_LEASE_MS } } };
}

export function requireSweepOwner(state: SweepCheckpoint, claim: SweepClaim, now: number): void {
  if (!Number.isFinite(now) || state.owner?.token !== claim.token
    || state.owner.runId !== claim.runId || state.owner.expiresAt <= now) {
    throw new Error("Acceptance sweep ownership lost");
  }
}

export function acknowledgeSweep(state: SweepCheckpoint, claim: SweepClaim, now: number): SweepCheckpoint {
  requireSweepOwner(state, claim, now);
  return {
    ...state,
    owner: null,
    pending: state.pending?.runId === claim.runId ? null : state.pending,
    acknowledgedRunId: claim.runId ?? state.acknowledgedRunId,
  };
}
