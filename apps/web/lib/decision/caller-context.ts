// Decision caller-context resolution (decision-surface consolidation, BI-E1FB2307).
//
// Maps a decision caller to (a) its Principal (for attribution/ledger) and
// (b) the governing decision-perspective profile, enforcing the WWMD-vs-WWWD
// boundary (AGENTS.md §16): a *business* decision is governed by the
// organization's WWWD profile; platform-development work is governed by the
// founder/platform WWMD profile.
//
// Routing keys on the decision DOMAIN when the caller declares one
// (BI-HDLEMP-01, kernel-ratified route-on-domain, WWMD ledger DI-58E1256CD8B4):
// a business-class decision resolves to WWWD and a platform-development decision
// to WWMD REGARDLESS of who calls — so an external agent operating an
// organization's business is no longer scored against founder doctrine. When no
// decisionDomain is declared, resolution falls back to the legacy
// callingPopulation heuristic (in-portal coworker => business), which preserves
// every prior caller's behaviour.
//
// True multi-tenant org scoping (no caller->org link exists today) remains
// tracked by BI-E1FB2307 (Gate routing) and BI-EF3F4A2D (multi-tenant identity).

import {
  resolvePrincipalIdForUser,
  resolvePrincipalIdForAgent,
} from "@/lib/identity/principal-linking";

export type DecisionCallingPopulation =
  | "in_platform_coworker"
  | "external_coding_agent"
  | "human";

/**
 * The class of decision being made, which — when declared — governs WWMD-vs-WWWD
 * routing independently of the calling population (BI-HDLEMP-01):
 * - `org-business` — a decision about operating the organization's business
 *   (pricing, staffing, customer stance, ...). Governed by the org WWWD profile.
 * - `platform-development` — a decision about building/evolving the platform
 *   itself. Governed by the founder WWMD profile.
 */
export type DecisionDomain = "org-business" | "platform-development";

export type GoverningProfileKind = "platform" | "organization";

/** WWMD — founder / platform-development profile (`kind: "platform"`). */
export const WWMD_PLATFORM_PROFILE_ID = "mark-dpf-platform";
/** WWWD — customer / organization business-operating-principles profile (`kind: "organization"`). */
export const WWWD_ORGANIZATION_PROFILE_ID = "dpf-organizational-principles";

export type DecisionCallerContext = {
  /** Principal behind the caller, when resolvable (for the decision ledger). */
  principalId: string | null;
  /** The decision-perspective profile that governs this caller's decisions. */
  governingProfileId: string;
  governingProfileKind: GoverningProfileKind;
  callingPopulation: DecisionCallingPopulation;
  /** How the profile was chosen — for the response + audit trail. */
  resolvedVia: "decision-domain" | "calling-population";
};

type PrincipalResolverDb = Parameters<typeof resolvePrincipalIdForUser>[1];

export async function resolveDecisionCallerContext(
  input: {
    callingPopulation: DecisionCallingPopulation;
    /**
     * The decision's domain. When present it governs WWMD-vs-WWWD routing and
     * overrides the callingPopulation heuristic (BI-HDLEMP-01). When absent,
     * routing falls back to callingPopulation for backward compatibility.
     */
    decisionDomain?: DecisionDomain | null;
    userId?: string | null;
    agentId?: string | null;
  },
  db?: PrincipalResolverDb,
): Promise<DecisionCallerContext> {
  // Attribute to a principal where possible: prefer the agent alias for
  // in-portal coworkers, fall back to the user alias.
  let principalId: string | null = null;
  if (input.agentId) {
    principalId = await resolvePrincipalIdForAgent(input.agentId, db);
  }
  if (!principalId && input.userId) {
    principalId = await resolvePrincipalIdForUser(input.userId, db);
  }

  // Route on the declared decision domain when present (BI-HDLEMP-01); else
  // fall back to the legacy callingPopulation heuristic. A business decision is
  // governed by the org WWWD profile and a platform decision by WWMD — so an
  // external agent operating an organization's business reaches the org's own
  // stance instead of founder doctrine.
  const isBusiness = input.decisionDomain
    ? input.decisionDomain === "org-business"
    : input.callingPopulation === "in_platform_coworker";
  const resolvedVia: DecisionCallerContext["resolvedVia"] = input.decisionDomain
    ? "decision-domain"
    : "calling-population";

  return {
    principalId,
    governingProfileId: isBusiness
      ? WWWD_ORGANIZATION_PROFILE_ID
      : WWMD_PLATFORM_PROFILE_ID,
    governingProfileKind: isBusiness ? "organization" : "platform",
    callingPopulation: input.callingPopulation,
    resolvedVia,
  };
}
