// Decision caller-context resolution (decision-surface consolidation, BI-E1FB2307).
//
// Maps a decision caller to (a) its Principal (for attribution/ledger) and
// (b) the governing decision-perspective profile, enforcing the WWMD-vs-WWWD
// boundary (AGENTS.md §16): an in-portal coworker's *business* decision is
// governed by the organization's WWWD profile; platform-development work
// (external coding agents, humans contributing to the platform) is governed by
// the founder/platform WWMD profile.
//
// Resolution here is callingPopulation-based BY DESIGN. Richer
// ownerPrincipalId/defaultResolver/fallback-chain selection and true
// multi-tenant org scoping (no caller->org link exists today) are tracked by
// BI-E1FB2307 (Gate routing) and BI-EF3F4A2D (multi-tenant identity).

import {
  resolvePrincipalIdForUser,
  resolvePrincipalIdForAgent,
} from "@/lib/identity/principal-linking";

export type DecisionCallingPopulation =
  | "in_platform_coworker"
  | "external_coding_agent"
  | "human";

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
  resolvedVia: "calling-population";
};

type PrincipalResolverDb = Parameters<typeof resolvePrincipalIdForUser>[1];

export async function resolveDecisionCallerContext(
  input: {
    callingPopulation: DecisionCallingPopulation;
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

  const isBusiness = input.callingPopulation === "in_platform_coworker";

  return {
    principalId,
    governingProfileId: isBusiness
      ? WWWD_ORGANIZATION_PROFILE_ID
      : WWMD_PLATFORM_PROFILE_ID,
    governingProfileKind: isBusiness ? "organization" : "platform",
    callingPopulation: input.callingPopulation,
    resolvedVia: "calling-population",
  };
}
