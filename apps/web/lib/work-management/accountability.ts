import type { WorkCaseActorRef } from "./case-types";

export const WORK_CASE_AUTHORITY_MODES = [
  "autonomous",
  "on-behalf-of",
  "authenticated-inbound",
] as const;

export type WorkCaseAuthorityMode = (typeof WORK_CASE_AUTHORITY_MODES)[number];

export interface WorkCaseAccountabilityContext {
  actor: WorkCaseActorRef;
  authorityMode: WorkCaseAuthorityMode;
  sponsorPrincipalId?: string | null;
  delegatingPrincipalId?: string | null;
  authenticatedInboundPrincipalId?: string | null;
  accountablePrincipalId?: string | null;
}

export type WorkCaseAccountabilityDenialReason =
  | "missing_agent_sponsor"
  | "missing_delegating_principal"
  | "missing_authenticated_inbound_principal";

export type WorkCaseAccountabilityDecision =
  | {
      ok: true;
      accountablePrincipalId?: string;
    }
  | {
      ok: false;
      reason: WorkCaseAccountabilityDenialReason;
      message: string;
    };

function present(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function actorLabel(actor: WorkCaseActorRef): string {
  return actor.actorId?.trim() || actor.displayName?.trim() || actor.actorKind;
}

export function validateWorkCaseAccountability(
  context: WorkCaseAccountabilityContext,
): WorkCaseAccountabilityDecision {
  const actor = context.actor;
  const label = actorLabel(actor);

  if (
    context.authorityMode === "authenticated-inbound" &&
    !present(context.authenticatedInboundPrincipalId)
  ) {
    return {
      ok: false,
      reason: "missing_authenticated_inbound_principal",
      message: `Actor ${label} requires authenticatedInboundPrincipalId for authenticated-inbound authority.`,
    };
  }

  if (context.authorityMode === "on-behalf-of" && !present(context.delegatingPrincipalId)) {
    return {
      ok: false,
      reason: "missing_delegating_principal",
      message: `Actor ${label} requires delegatingPrincipalId for on-behalf-of authority.`,
    };
  }

  if (
    actor.actorKind === "agent" &&
    context.authorityMode !== "authenticated-inbound" &&
    !present(context.sponsorPrincipalId)
  ) {
    return {
      ok: false,
      reason: "missing_agent_sponsor",
      message: `Agent actor ${label} requires sponsorPrincipalId for ${context.authorityMode} authority.`,
    };
  }

  return {
    ok: true,
    accountablePrincipalId:
      context.accountablePrincipalId ??
      context.sponsorPrincipalId ??
      context.authenticatedInboundPrincipalId ??
      context.delegatingPrincipalId ??
      actor.actorId,
  };
}
