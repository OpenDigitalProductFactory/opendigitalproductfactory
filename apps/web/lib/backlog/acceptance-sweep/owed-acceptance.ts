import type {
  InitiativeReadinessDecision,
  ReadinessCode,
  ReadinessRequirementResult,
} from "@/lib/backlog/initiative-readiness/types";
import type {
  TerminalInitiativeRecovery,
  TerminalRecoveryEscalationReason,
} from "@/lib/backlog/initiative-readiness/terminal-recovery";
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
  /** The terminal recovery chain (Workroom, baseline, evidence) could not bind a route; the sweep's resolver runs it. */
  | TerminalRecoveryEscalationReason
  /** The accountable role has no writer lane (resolver `unroutable`). */
  | "no-writer-lane"
  /** The only route the resolver found targets the authoring agent. */
  | "author-excluded"
  /** The resolver reported nothing for this requirement. */
  | "unresolved"
  /** Only coworkers that run outside the platform hold the lane (BI-C1781121, in-platform-owners.ts). */
  | "no-in-platform-coworker";

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
 * Port over `resolveInitiativeReviewerRecovery`. The production adapters are
 * `createOwedAcceptanceOwnerResolver` (given a dispatch context) and the
 * sweep's `createSweepOwnerResolver` (which runs the terminal recovery chain to
 * find the item's Workroom, baseline and evidence); tests inject their own.
 */
export type OwedAcceptanceOwnerResolver = (args: {
  decision: InitiativeReadinessDecision;
  authorAgentId: string | null;
}) => Promise<OwedAcceptanceOwnerRecovery>;

/**
 * A coworker an owner resolver names for an accountable role. A reviewer route
 * covers every owed code of its role; a route with `codes` covers only those
 * (the small-shape execution-evidence lane, execution-evidence-owner.ts, owns
 * the delivery-coordinator's evidence codes and not, say, its capsule identity).
 */
export type OwedAcceptanceRoute = Pick<
  InitiativeReviewerRecovery["reviewerRoutes"][number],
  "accountableRole" | "toolName" | "grant" | "targetAgentId" | "targetDisplayName"
> & { codes?: readonly ReadinessCode[] };

/**
 * What an owner resolver returns: the reviewer recovery (or the terminal
 * chain's), whose escalation reasons may also be `no-in-platform-coworker`.
 * An escalation with `codes` applies to those codes of its role only.
 */
export type OwedAcceptanceOwnerRecovery = {
  reviewerRoutes: OwedAcceptanceRoute[];
  unroutable: InitiativeReviewerRecovery["unroutable"];
  escalations: Array<{
    accountableRole: string;
    toolName: string;
    grant: string;
    reason:
      | TerminalInitiativeRecovery["escalations"][number]["reason"]
      | "no-in-platform-coworker";
    nextAction: string;
    codes?: readonly ReadinessCode[];
  }>;
};

/** Does a route or escalation speak for this owed requirement? */
function covers(row: { accountableRole: string; codes?: readonly ReadinessCode[] }, entry: { accountableRole: string; code: ReadinessCode }): boolean {
  return row.accountableRole === entry.accountableRole && (!row.codes || row.codes.includes(entry.code));
}

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
  const ownerRoutes = routable.filter((route) => route.targetAgentId === ownerRoute?.targetAgentId);
  const isOwned = (entry: (typeof family)[number]) => ownerRoutes.some((route) => covers(route, entry));

  const owner: OwedAcceptanceOwner | null = ownerRoute
    ? {
        agentId: ownerRoute.targetAgentId,
        displayName: ownerRoute.targetDisplayName,
        codes: family.filter(isOwned).map((entry) => entry.code),
      }
    : null;

  const unroutable: OwedAcceptanceUnroutable[] = [];
  for (const entry of family) {
    if (isOwned(entry)) continue;
    const base = { code: entry.code, accountableRole: entry.accountableRole };
    const noLane = recovery.unroutable.find((row) => row.code === entry.code && row.accountableRole === entry.accountableRole);
    if (noLane) {
      unroutable.push({ ...base, reason: "no-writer-lane", nextAction: noLane.nextAction });
      continue;
    }
    const escalation = recovery.escalations.find((row) => covers(row, entry));
    if (escalation) {
      unroutable.push({ ...base, reason: escalation.reason, nextAction: escalation.nextAction });
      continue;
    }
    if (familyRoutes.some((route) => covers(route, entry))) {
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
