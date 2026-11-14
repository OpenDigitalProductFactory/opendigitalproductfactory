import type { GithubPrReadiness } from "./github-pr-readiness";
import type { BuildPrDeliveryStateV1 } from "./build-pr-delivery-state";

/**
 * When a PR room is observed again (BI-0EDCF2EC, WWMD DI-787092F3E267).
 *
 * GitHub computes a PR's merge state lazily and recomputes it whenever main
 * moves, so an undecided state is an infrastructure condition, not a reason to
 * stop. PR #6983 (WC-8B8A9D6F) was stopped for good on 2026-11-13 because the
 * reconciler compared its lifetime observation count with this budget, and a
 * stopped room was never looked at again. Now an undecided state backs off and
 * keeps being observed, and a stop whose cause GitHub can clear is re-checked.
 */

/** Undecided observations of one head in a row before the room backs off and a person is told. */
export const MAX_UNKNOWN_OBSERVATIONS = 6;
const BACKOFF_BASE_MS = 5 * 60 * 1000;
const BACKOFF_CAP_MS = 60 * 60 * 1000;
/** How often a re-evaluable stop is observed again. */
export const ESCALATION_RECHECK_MS = 30 * 60 * 1000;

const OBSERVATION_BUDGET_STOP = "observation-budget-exhausted:";

export function consecutiveUnknownObservations(state: BuildPrDeliveryStateV1, headSha: string | null): number {
  return state.lastReadiness === "unknown" && state.lastObservedHeadSha === headSha ? state.unknownObservations : 0;
}

/** The streak and next observation time after one more undecided observation of `headSha`. */
export function nextUnknownObservation(
  state: BuildPrDeliveryStateV1,
  headSha: string | null,
  now: Date,
): { unknownObservations: number; nextObservationAt: string | null } {
  const unknownObservations = consecutiveUnknownObservations(state, headSha) + 1;
  if (unknownObservations < MAX_UNKNOWN_OBSERVATIONS) return { unknownObservations, nextObservationAt: null };
  const doublings = Math.min(unknownObservations - MAX_UNKNOWN_OBSERVATIONS + 1, 10);
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** doublings, BACKOFF_CAP_MS);
  return { unknownObservations, nextObservationAt: new Date(now.getTime() + delay).toISOString() };
}

/** The readiness that caused a stop GitHub alone can clear; null when a person must act. */
function stoppingCondition(lastError: string | null): GithubPrReadiness["kind"] | "observation" | null {
  if (!lastError) return null;
  if (lastError.startsWith(OBSERVATION_BUDGET_STOP)) return "observation";
  if (lastError === "true-merge-conflict") return "conflict";
  if (lastError === "stale-update-budget-exhausted") return "behind";
  return null;
}

export function isReevaluableEscalation(state: BuildPrDeliveryStateV1): boolean {
  return state.status === "escalated" && stoppingCondition(state.lastError) !== null;
}

export type EscalationRecheck =
  | { kind: "not-escalated" | "not-reevaluable" | "holds" }
  | { kind: "cleared"; state: BuildPrDeliveryStateV1; reason: string };

/**
 * Lift a stop whose condition no longer holds. An observation-budget stop is
 * always lifted: an undecided merge state no longer stops a room at all.
 */
export function resumeClearedEscalation(
  state: BuildPrDeliveryStateV1,
  readiness: GithubPrReadiness,
): EscalationRecheck {
  if (state.status !== "escalated") return { kind: "not-escalated" };
  const condition = stoppingCondition(state.lastError);
  if (!condition) return { kind: "not-reevaluable" };
  if (condition === readiness.kind) return { kind: "holds" };
  return {
    kind: "cleared",
    reason: state.lastError ?? condition,
    state: {
      ...state,
      status: "checking",
      escalationKey: null,
      lastError: null,
      unknownObservations: 0,
      nextObservationAt: null,
      staleUpdateAttempts: condition === "behind" ? 0 : state.staleUpdateAttempts,
    },
  };
}

/** Whether the selector should hand this room to the reconciler now. */
export function isDeliveryObservationDue(state: BuildPrDeliveryStateV1 | null, now: Date): boolean {
  if (!state) return true;
  if (state.status === "closed" || state.status === "deployed") return false;
  if (state.status === "escalated") {
    if (!isReevaluableEscalation(state)) return false;
    const last = state.lastObservedAt ? Date.parse(state.lastObservedAt) : Number.NaN;
    return !Number.isFinite(last) || now.getTime() - last >= ESCALATION_RECHECK_MS;
  }
  const next = state.nextObservationAt ? Date.parse(state.nextObservationAt) : Number.NaN;
  return !Number.isFinite(next) || next <= now.getTime();
}
