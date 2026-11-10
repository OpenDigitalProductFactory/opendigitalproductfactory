// Workforce staffing posture — why a declared role is not staffed.
//
// WHY THIS EXISTS. agent_registry.json carries `status` (active | defined |
// draft), which says what LIFECYCLE STATE a role is in. It does not say whether
// a non-active role is deliberately non-active, or simply unfinished. The
// capability measure could only read the second meaning, so 39 declared roles
// each reported five open gaps — 194 of 235 — and the platform read as though
// it were four-fifths broken.
//
// It is not broken. Most of those roles are a standards-derived catalogue: each
// AGT-1xx entry cites the IT4IT sections and MUST requirements it realises (see
// `it4it_sections`) and names a human supervisor. They were authored as a
// conformance map, not as a hiring plan. An earlier pass at this guessed from
// role NAMES that ~110 of the 194 were duplicates; reading the capability texts
// showed only two were. Names are not evidence.
//
// WHERE IT LIVES. On the registry entry itself, as `staffing_posture`. The
// measure is a plain .mjs that cannot import TypeScript, so a posture declared
// in a module here would have needed a second, textually-parsed copy — which is
// the split-registry defect this codebase has hit four times. One home, two
// readers: this module is the typed reader and the guard; the JSON is the fact.
//
// THIS IS NOT A WAY TO HIDE GAPS. The measure's rule is that no identity is
// excluded, and that holds: a posture changes an identity's CLASS, never its
// visibility. Every posture carries a reason a person can argue with and a
// `reviewBy` date, and workforce-staffing-posture.test.ts FAILS THE BUILD once a
// review date passes. Parking a role is a decision with an expiry, not amnesia —
// the same discipline as the 90-day reference-staleness ceiling.
//
// THE TEST APPLIED. This install exists to grow the use of, and support, the platform.
// Investment follows the priority of existing customers and the activities that
// win new ones (operator, 2026-09-16). A role serving neither — platform
// plumbing like SBOM composition or IaC execution — is real work that is not
// this quarter's work, and saying so is more honest than recording it as a hole
// in the workforce.
//
// DELIBERATELY NOT PARKED. AGT-150/151/152 (service offer definition, catalog
// publication, subscription management) and AGT-160/161/162 (consumer
// onboarding, order fulfillment, service support) sit directly on the two
// objectives the operator funds against. Parking those is an operator decision, not
// an engineering one, so they keep reporting as open gaps until someone decides.

import registry from "../data/agent_registry.json" with { type: "json" };

/** Why a declared role is not staffed. */
export type StaffingPostureState =
  /**
   * The work exists and is done — by a different identity. This role is a
   * second name for it, so counting it as missing double-counts the estate.
   */
  | "superseded"
  /**
   * Declared, consciously not staffed, and reviewable. The work is real; it is
   * not funded now. Requires a reason and an expiry.
   */
  | "deliberately-unstaffed";

export type StaffingPosture = {
  state: StaffingPostureState;
  /** Required for "superseded": the identity that actually does this work. */
  supersededBy?: string;
  /** Why — in terms a person can disagree with. */
  reason: string;
  /** ISO date. Past this, the guard fails: a parked role must be re-decided. */
  reviewBy: string;
};

type RegistryAgent = {
  agent_id: string;
  status?: string;
  staffing_posture?: StaffingPosture;
};

const AGENTS = (Array.isArray(registry)
  ? registry
  : (registry as { agents?: unknown[] }).agents ?? []) as RegistryAgent[];

/** Every declared posture, keyed by agent id. */
export const WORKFORCE_STAFFING_POSTURE: Readonly<Record<string, StaffingPosture>> =
  Object.freeze(
    Object.fromEntries(
      AGENTS.filter((a) => a.staffing_posture).map((a) => [a.agent_id, a.staffing_posture!]),
    ),
  );

/** Posture for an agent id, or null when the role carries none. */
export function staffingPostureFor(agentId: string): StaffingPosture | null {
  return WORKFORCE_STAFFING_POSTURE[agentId] ?? null;
}

/**
 * True when this identity's gaps should not be counted as OPEN.
 *
 * Both postures qualify, for different reasons: a superseded role's capability
 * is not missing (another identity holds it), and a deliberately-unstaffed role
 * is a decision rather than a defect. Neither is removed from the report.
 */
export function isPostureExcusedFromOpenGaps(agentId: string): boolean {
  return staffingPostureFor(agentId) !== null;
}

/** Ids whose work is done by another identity, mapped to that identity. */
export function supersessionMap(): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [id, p] of Object.entries(WORKFORCE_STAFFING_POSTURE)) {
    if (p.state === "superseded" && p.supersededBy) out[id] = p.supersededBy;
  }
  return out;
}

/** Postures whose reviewBy has passed, as of `now`. A parking has an expiry. */
export function expiredPostures(now: Date = new Date()): string[] {
  return Object.entries(WORKFORCE_STAFFING_POSTURE)
    .filter(([, p]) => new Date(p.reviewBy).getTime() <= now.getTime())
    .map(([id]) => id)
    .sort();
}
