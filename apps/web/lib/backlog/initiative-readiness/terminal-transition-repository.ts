import { randomUUID } from "node:crypto";

import { ok, type ActionResult } from "@/lib/shared/action-result";

import { readinessRequirement } from "./readiness-guidance";
import type { InitiativeReadinessDecision, ReadinessCode } from "./types";

export type TerminalTransitionClient = {
  authorizationDecisionLog: { create(args: unknown): Promise<unknown> };
  backlogItemActivity: { create(args: unknown): Promise<unknown> };
};

export type TerminalTransitionDb = {
  $transaction<T>(
    work: (client: TerminalTransitionClient) => Promise<T>,
    options?: { isolationLevel: "Serializable" },
  ): Promise<T>;
};

export type TerminalActor = {
  actorType: "human" | "agent";
  actorRef: string;
  humanContextRef: string;
  agentContextRef: string | null;
};

export type TerminalAuthority = {
  organizationId: string | null;
  actionKey: string;
  objectRef: string;
  rationale: Record<string, unknown>;
  authoritySnapshot: {
    decision: "allow";
    effectiveHumanCapability: string;
    effectiveAgentGrant: string;
    tokenScope: string;
    organizationId: string;
    actionKey: string;
    policyVersion: string;
  };
};

type ResolvedTerminalReadiness = {
  governed: boolean;
  decision: InitiativeReadinessDecision;
  factsDigest: string;
  anchorBacklogItemId?: string;
};

export type GovernedTerminalTransitionSuccess = Exclude<ActionResult<void>, { error: string }> & {
  decision: InitiativeReadinessDecision;
  authorityDecisionId: string;
};

export type GovernedTerminalTransitionResult =
  | GovernedTerminalTransitionSuccess
  | { ok: false; code: ReadinessCode; decision: InitiativeReadinessDecision; authorityDecisionId: string };

class TerminalCasConflict extends Error {
  constructor() {
    super("Terminal transition compare-and-set missed");
  }
}

function nextDecisionId() {
  return `IRD-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

function nextAuthorityDecisionId() {
  return `DI-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

function stableCodes(decision: InitiativeReadinessDecision): ReadinessCode[] {
  return [...decision.blockers, ...decision.unmet].map((entry) => entry.code);
}

function firstCode(decision: InitiativeReadinessDecision): ReadinessCode {
  return stableCodes(decision)[0] ?? "READINESS_PROJECTION_FAILED";
}

function withDecisionId(decision: InitiativeReadinessDecision): InitiativeReadinessDecision {
  return { ...decision, decisionId: nextDecisionId() };
}

function terminalSuccess(
  decision: InitiativeReadinessDecision,
  authorityDecisionId: string,
): GovernedTerminalTransitionSuccess {
  const success = ok();
  if (!success.ok) throw new Error("Canonical success constructor returned an error.");
  return { ...success, decision, authorityDecisionId };
}

function staleDecision(decision: InitiativeReadinessDecision): InitiativeReadinessDecision {
  return {
    ...decision,
    decisionId: nextDecisionId(),
    verdict: "denied",
    unmet: [],
    blockers: [readinessRequirement({
      code: "STALE_EVIDENCE",
      state: "blocked",
      accountableRole: "delivery-coordinator",
      profile: decision.profile,
    })],
  };
}

async function persistAttempt(args: {
  tx: TerminalTransitionClient;
  anchorBacklogItemId: string;
  actor: TerminalActor;
  authority: TerminalAuthority;
  authorityDecisionId: string;
  decision: InitiativeReadinessDecision;
  factsDigest: string;
}) {
  await args.tx.authorizationDecisionLog.create({ data: {
    decisionId: args.authorityDecisionId,
    actorType: args.actor.actorType,
    actorRef: args.actor.actorRef,
    humanContextRef: args.actor.humanContextRef,
    agentContextRef: args.actor.agentContextRef,
    organizationId: args.authority.organizationId,
    policyVersion: args.authority.authoritySnapshot.policyVersion,
    actionKey: args.authority.actionKey,
    objectRef: args.authority.objectRef,
    decision: "allow",
    rationale: args.authority.rationale,
    mode: "enforce",
  } });
  await args.tx.backlogItemActivity.create({ data: {
    backlogItemId: args.anchorBacklogItemId,
    kind: "initiative_readiness_decision",
    summary: `completion readiness: ${args.decision.verdict}`,
    payload: {
      schemaVersion: 1,
      ...args.decision,
      factsDigest: args.factsDigest,
      stableCodes: stableCodes(args.decision),
      authorityDecisionId: args.authorityDecisionId,
      authoritySnapshot: args.authority.authoritySnapshot,
      enforcementState: "enforced",
    },
    recordedById: args.actor.humanContextRef,
    recordedByAgentId: args.actor.agentContextRef,
  } });
}

/**
 * The single terminal mutation boundary. Resolution, authority/audit writes,
 * readiness decision, and the caller's compare-and-set mutation share one
 * serializable transaction. A CAS miss is reevaluated as a denied attempt.
 */
export async function executeGovernedTerminalTransition(args: {
  db: TerminalTransitionDb;
  anchorBacklogItemId?: string;
  actor: TerminalActor;
  authority: TerminalAuthority;
  resolve(tx: TerminalTransitionClient): Promise<ResolvedTerminalReadiness>;
  mutate(tx: TerminalTransitionClient): Promise<number>;
}): Promise<GovernedTerminalTransitionResult> {
  const attemptState: { resolved?: ResolvedTerminalReadiness } = {};
  try {
    return await args.db.$transaction(async (tx) => {
      const resolved = await args.resolve(tx);
      attemptState.resolved = resolved;
      const decision = withDecisionId(resolved.decision);
      const authorityDecisionId = nextAuthorityDecisionId();
      if (!resolved.governed) {
        const count = await args.mutate(tx);
        if (count !== 1) throw new TerminalCasConflict();
        return terminalSuccess(decision, authorityDecisionId);
      }
      const anchorBacklogItemId = resolved.anchorBacklogItemId ?? args.anchorBacklogItemId;
      if (!anchorBacklogItemId) throw new Error("Governed terminal transition has no backlog receipt anchor.");
      await persistAttempt({ ...args, tx, anchorBacklogItemId, decision, authorityDecisionId, factsDigest: resolved.factsDigest });
      if (decision.verdict !== "allowed") {
        return { ok: false, code: firstCode(decision), decision, authorityDecisionId };
      }
      const count = await args.mutate(tx);
      if (count !== 1) throw new TerminalCasConflict();
      return terminalSuccess(decision, authorityDecisionId);
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    const attempted = attemptState.resolved;
    if (!(error instanceof TerminalCasConflict) || !attempted) throw error;
    const denied = staleDecision(attempted.decision);
    const authorityDecisionId = nextAuthorityDecisionId();
    const anchorBacklogItemId = attempted.anchorBacklogItemId ?? args.anchorBacklogItemId;
    if (!anchorBacklogItemId) throw new Error("Governed terminal transition has no backlog receipt anchor.");
    await args.db.$transaction(async (tx) => {
      await persistAttempt({
        ...args,
        tx,
        anchorBacklogItemId,
        decision: denied,
        authorityDecisionId,
        factsDigest: attempted.factsDigest,
      });
    }, { isolationLevel: "Serializable" });
    return { ok: false, code: "STALE_EVIDENCE", decision: denied, authorityDecisionId };
  }
}
