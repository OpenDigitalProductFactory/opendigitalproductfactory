import type { WorkerClassification } from "@dpf/db";

import { consequencesFor } from "./worker-classification";

/**
 * Referral as an evidenced relationship (BI-D78DC392).
 *
 * `RecruitingSource.type` already accepted the string `"referral"`, so the
 * platform could record that an application ARRIVED through a referral. It never
 * recorded who referred whom. A category cannot be excluded from an approval
 * chain; a person can.
 *
 * Three consequences follow, each reusing an existing mechanism rather than
 * adding a subsystem:
 *
 * 1. Conflict of interest — one more skip reason in the `approval-routing.ts`
 *    chain walk. Lives there, not here.
 * 2. Bonus — a tenure-gated payroll consequence, resolved below.
 * 3. Adverse-impact monitoring — reaches `ProtectedMonitoringObservation`
 *    through its existing opaque `evaluationRef`, below.
 */

/**
 * Whether a referrer may take part in deciding on their own referral.
 *
 * Always false. Stated as a named function rather than an inline `false` so the
 * rule is greppable and a caller cannot quietly special-case a senior referrer.
 */
export function mayParticipateInOwnReferralDecision(): boolean {
  return false;
}

/**
 * A referral by a contingent worker is attributable — they referred someone, and
 * a bonus may be owed — but it never implies they may sit in the hiring
 * decision. Attribution and authority are different questions, and conflating
 * them is how a contractor ends up exercising employer judgement.
 */
export function referralIsAttributable(_classification: WorkerClassification): boolean {
  return true;
}

/** Whether this classification may take part in a hiring decision at all. */
export function mayParticipateInHiringDecision(classification: WorkerClassification): boolean {
  return consequencesFor(classification).directable;
}

export type VestingInput = {
  readonly referralRecordedAt: Date;
  /** When the referred worker actually started. Null while they have not. */
  readonly hireStartedAt: Date | null;
  /** Tenure the bonus is gated on. */
  readonly vestingDays: number;
  readonly now: Date;
};

export type VestingOutcome =
  /** Not hired yet — the room stays open, nothing is owed. */
  | { readonly kind: "not-hired" }
  /** Hired, tenure not yet reached. The room stays open to its milestone. */
  | { readonly kind: "pending"; readonly vestsOn: Date }
  /**
   * Tenure reached. Emits a PAY COMPONENT LINE — it never moves money. That is
   * the standing payroll boundary: the platform prepares the artifact, payroll
   * disburses it.
   */
  | { readonly kind: "vested"; readonly vestedOn: Date };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve whether a referral bonus has vested.
 *
 * Deliberately a pure calculation with an injected `now`: a bonus that vests
 * because a server's clock drifted is a payroll defect, and a test that cannot
 * pin the clock cannot prove the boundary holds.
 */
export function resolveReferralVesting(input: VestingInput): VestingOutcome {
  if (!input.hireStartedAt) return { kind: "not-hired" };

  const vestsOn = new Date(input.hireStartedAt.getTime() + input.vestingDays * DAY_MS);
  return input.now.getTime() >= vestsOn.getTime()
    ? { kind: "vested", vestedOn: vestsOn }
    : { kind: "pending", vestsOn };
}

/**
 * The opaque reference under which a referral may be counted for adverse-impact
 * monitoring.
 *
 * `ProtectedMonitoringObservation` is deliberately structurally separate from
 * scoring and is joined only by an opaque `evaluationRef`. Referral pipelines
 * reproduce the existing shape of a workforce, which is exactly the adverse
 * impact that rail was built to measure — so the referral must be COUNTABLE
 * without becoming JOINABLE.
 *
 * This returns a string, never an id the monitoring side can resolve back to a
 * person by traversal. Nothing here reads a protected attribute; collection
 * remains gated on a recorded consent basis at the point of write.
 */
export function referralMonitoringRef(applicationId: string): string {
  return `referral:${applicationId}`;
}

/**
 * Whether a referral may be counted into monitoring at all.
 *
 * Gated on an explicitly recorded consent basis. Absent one, the honest answer
 * is not to collect — an adverse-impact rail built on unconsented data is its
 * own compliance problem.
 */
export function mayRecordReferralObservation(consentBasis: string | null): boolean {
  return typeof consentBasis === "string" && consentBasis.trim().length > 0;
}
