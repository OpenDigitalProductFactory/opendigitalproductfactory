import type {
  InitiativeReadinessDecision,
  ReadinessCode,
  ReadinessRequirementResult,
} from "@/lib/backlog/initiative-readiness/types";
import type { InitiativeReviewerRecovery } from "@/lib/tak/initiative-readiness-tool-grants";

// Owed acceptance: who owes an awaiting-acceptance item's acceptance and what
// would settle it (BI-04140C98, AC-AA-01).
// Design: docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md §3.1.
//
// A projection over the completion readiness decision. Readiness stays the
// single source of what is owed now; this module adds no rule of its own. It
// only names the owner the grant-backed resolver finds, with the author
// excluded, and carries every requirement it cannot route with its reason.
// Nothing here defaults to a person.

/** Roles whose requirements a sweep may route to an acceptance owner. */
export const ACCEPTANCE_FAMILY_ROLES: readonly string[] = ["acceptance-reviewer", "delivery-coordinator"];

export type OwedAcceptanceRequirement = {
  code: ReadinessCode;
  state: ReadinessRequirementResult["state"];
  accountableRole: string;
  nextAction: string | null;
};

export type OwedAcceptanceOwner = {
  agentId: string;
  displayName: string;
  /** The owed codes this coworker is the resolved owner for. */
  codes: ReadinessCode[];
};

export type OwedAcceptanceUnroutableReason =
  | InitiativeReviewerRecovery["escalations"][number]["reason"]
  /** The accountable role has no writer lane (resolver `unroutable`). */
  | "no-writer-lane"
  /** The only route the resolver found targets the authoring agent. */
  | "author-excluded"
  /** The resolver reported nothing for this requirement. */
  | "unresolved";

export type OwedAcceptanceUnroutable = {
  code: ReadinessCode;
  accountableRole: string;
  reason: OwedAcceptanceUnroutableReason;
  nextAction: string | null;
};

export type OwedAcceptance = {
  /** Every unmet or blocking completion requirement: the "what", by code. */
  owed: OwedAcceptanceRequirement[];
  owner: OwedAcceptanceOwner | null;
  unroutable: OwedAcceptanceUnroutable[];
  /** The completion verdict is already allowed. Closing stays the terminal transition's decision. */
  closable: boolean;
};

/**
 * Port over `resolveInitiativeReviewerRecovery`. The production adapter is
 * `createOwedAcceptanceOwnerResolver`; tests inject their own.
 */
export type OwedAcceptanceOwnerResolver = (args: {
  decision: InitiativeReadinessDecision;
  authorAgentId: string | null;
}) => Promise<InitiativeReviewerRecovery>;

function isFamily(entry: { accountableRole: string }): boolean {
  return ACCEPTANCE_FAMILY_ROLES.includes(entry.accountableRole);
}

export async function projectOwedAcceptance(input: {
  decision: InitiativeReadinessDecision;
  authorAgentId: string | null;
  resolveOwner: OwedAcceptanceOwnerResolver;
}): Promise<OwedAcceptance> {
  const { decision, authorAgentId } = input;
  const requirements = [...decision.blockers, ...decision.unmet];
  const owed = requirements.map((entry) => ({
    code: entry.code,
    state: entry.state,
    accountableRole: entry.accountableRole,
    nextAction: entry.nextAction,
  }));
  const closable = decision.verdict === "allowed";

  const family = requirements.filter(isFamily);
  if (family.length === 0) return { owed, owner: null, unroutable: [], closable };

  const recovery = await input.resolveOwner({
    decision: {
      ...decision,
      blockers: decision.blockers.filter(isFamily),
      unmet: decision.unmet.filter(isFamily),
    },
    authorAgentId,
  });

  const familyRoutes = recovery.reviewerRoutes.filter(isFamily);
  const routable = familyRoutes.filter((route) => route.targetAgentId !== authorAgentId);
  const ownerRoute = routable[0] ?? null;
  const ownedRoles = new Set(
    routable.filter((route) => route.targetAgentId === ownerRoute?.targetAgentId).map((route) => route.accountableRole),
  );

  const owner: OwedAcceptanceOwner | null = ownerRoute
    ? {
        agentId: ownerRoute.targetAgentId,
        displayName: ownerRoute.targetDisplayName,
        codes: family.filter((entry) => ownedRoles.has(entry.accountableRole)).map((entry) => entry.code),
      }
    : null;

  const unroutable: OwedAcceptanceUnroutable[] = [];
  for (const entry of family) {
    if (ownedRoles.has(entry.accountableRole)) continue;
    const base = { code: entry.code, accountableRole: entry.accountableRole };
    const noLane = recovery.unroutable.find((row) => row.code === entry.code && row.accountableRole === entry.accountableRole);
    if (noLane) {
      unroutable.push({ ...base, reason: "no-writer-lane", nextAction: noLane.nextAction });
      continue;
    }
    const escalation = recovery.escalations.find((row) => row.accountableRole === entry.accountableRole);
    if (escalation) {
      unroutable.push({ ...base, reason: escalation.reason, nextAction: escalation.nextAction });
      continue;
    }
    if (familyRoutes.some((route) => route.accountableRole === entry.accountableRole)) {
      unroutable.push({
        ...base,
        reason: "author-excluded",
        nextAction: "The only coworker granted this lane authored the item; an acceptance sweep never routes the work back to its author. Grant the lane to another production coworker.",
      });
      continue;
    }
    unroutable.push({ ...base, reason: "unresolved", nextAction: entry.nextAction });
  }

  return { owed, owner, unroutable, closable };
}
