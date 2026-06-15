// Equitable-rationing scheduler for member-owned shared-asset pools.
// EP-ARCH-8D4F2A · BI-D7FCD029 (agricultural shared-machinery co-op).
//
// A commercial rental desk allocates contended capacity first-come-first-served
// — whoever books first wins. A member-OWNED pool cannot: the asset belongs to
// the members collectively, so when demand for a window exceeds capacity the
// allocation must be *equitable*, not merely fast. This is the co-op analog of
// the member-equity/patronage principle applied to the booking calendar.
//
// Pure + deterministic so it unit-tests without a DB and the same ranking can
// be shown to members as the published allocation rationale. Fairness =
// lower recent usage first (patronage-balanced / "everyone gets a turn"), then
// a per-member concurrency cap during the window, then earlier request time as
// the final tiebreak. No randomness — ties resolve on stable, explainable keys.

import {
  type AgreementPeriod,
  countOverlappingAgreements,
  periodsOverlap,
} from "./rental";

export interface RationRequest {
  /** Stable request identity (agreementRef or a transient key). */
  requestRef: string;
  /** Member-owner placing the request. */
  memberId: string;
  /** When the request was submitted (tiebreak only — never the primary key). */
  requestedAt: Date;
  periodStart: Date;
  periodEnd: Date;
}

export interface RationConfig {
  /** Total pool capacity for the class over the contended window. */
  capacity: number;
  /** Max concurrent active+granted reservations a single member may hold in the window. */
  maxConcurrentPerMember: number;
  /**
   * Recent usage per member (e.g. unit-days consumed this season) — the
   * patronage-balancing signal. Absent members are treated as zero usage and
   * therefore rank ahead of heavy users. Lower usage = higher priority.
   */
  recentUsage?: Record<string, number>;
  /** Reservations already occupying the pool in this window (count against capacity). */
  existing?: readonly AgreementPeriod[];
}

export type RationDecision =
  | { requestRef: string; memberId: string; status: "granted" }
  | {
      requestRef: string;
      memberId: string;
      status: "waitlisted";
      reason: "capacity-exhausted" | "member-cap-reached";
    };

export interface RationOutcome {
  decisions: RationDecision[];
  granted: RationDecision[];
  waitlisted: RationDecision[];
}

/** Lower score = allocate earlier. Stable, fully explainable ordering. */
function fairnessKey(
  req: RationRequest,
  recentUsage: Record<string, number>,
): [number, number, string] {
  return [
    recentUsage[req.memberId] ?? 0, // 1. least-served member first
    req.requestedAt.getTime(), // 2. earlier request wins the tie
    req.requestRef, // 3. fully deterministic final tiebreak
  ];
}

function compareKeys(
  a: [number, number, string],
  b: [number, number, string],
): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0;
}

/**
 * Allocate contended reservation requests equitably across member-owners.
 * Greedy over the fairness ranking: grant while window capacity remains and the
 * member is under their concurrency cap; otherwise waitlist with a reason.
 * Capacity is checked per-request against the union of pre-existing occupying
 * agreements and grants made earlier in this pass that overlap the request.
 */
export function rationReservations(
  requests: readonly RationRequest[],
  config: RationConfig,
): RationOutcome {
  const recentUsage = config.recentUsage ?? {};
  const existing = config.existing ?? [];
  const capacity = Math.max(0, config.capacity);
  const perMemberCap = Math.max(0, config.maxConcurrentPerMember);

  const ordered = [...requests].sort((a, b) =>
    compareKeys(fairnessKey(a, recentUsage), fairnessKey(b, recentUsage)),
  );

  const grants: AgreementPeriod[] = existing.map((e) => ({ ...e }));
  const memberGrantCount: Record<string, number> = {};
  const decisions: RationDecision[] = [];

  for (const req of ordered) {
    const held = memberGrantCount[req.memberId] ?? 0;
    if (held >= perMemberCap) {
      decisions.push({
        requestRef: req.requestRef,
        memberId: req.memberId,
        status: "waitlisted",
        reason: "member-cap-reached",
      });
      continue;
    }
    const overlapping = countOverlappingAgreements(
      grants,
      req.periodStart,
      req.periodEnd,
    );
    if (overlapping >= capacity) {
      decisions.push({
        requestRef: req.requestRef,
        memberId: req.memberId,
        status: "waitlisted",
        reason: "capacity-exhausted",
      });
      continue;
    }
    grants.push({
      status: "reserved",
      periodStart: req.periodStart,
      periodEnd: req.periodEnd,
    });
    memberGrantCount[req.memberId] = held + 1;
    decisions.push({
      requestRef: req.requestRef,
      memberId: req.memberId,
      status: "granted",
    });
  }

  return {
    decisions,
    granted: decisions.filter((d) => d.status === "granted"),
    waitlisted: decisions.filter((d) => d.status === "waitlisted"),
  };
}

/** Convenience: would this single request be granted against the current pool? */
export function wouldGrant(
  req: RationRequest,
  config: RationConfig,
): boolean {
  const existing = config.existing ?? [];
  const overlapping = existing.filter((e) =>
    periodsOverlap(e.periodStart, e.periodEnd, req.periodStart, req.periodEnd),
  ).length;
  return overlapping < Math.max(0, config.capacity);
}
