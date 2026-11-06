// The pure rules of a standing ruling (BI-E5631708). No database and no
// server-only import, so the inbox projection and tests can use them; the
// lookup and revocation live in standing-ruling.ts.

export const STANDING_RULING_VERSION = 1 as const;

/** The exact class one ruling covers. Every term must match on lookup. */
export type StandingRulingActionClass = {
  coworkerAgentId: string;
  toolName: string;
  delegatingUserId: string;
};

export type StandingRuling = {
  version: typeof STANDING_RULING_VERSION;
  state: "active" | "revoked";
  actionClass: StandingRulingActionClass;
  ruledBy: string;
  ruledAt: string;
  revokedBy?: string;
  revokedAt?: string;
};

export type StandingRulingIneligibility =
  | "not-an-authority-request"
  | "decided-on-behalf"
  | "binding-owner-mismatch"
  | "raised-under-propose-boundary"
  | "decision-unrecorded"
  | "damaging"
  | "not-unsteered";

export type StandingRulingEligibility =
  | { eligible: true; actionClass: StandingRulingActionClass }
  | { eligible: false; reason: StandingRulingIneligibility };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * May this envelope's approval become a standing ruling? Pure: the caller
 * supplies the envelope's stored arguments and its decision log rationale.
 */
export function standingRulingEligibility(input: {
  envelope: { coworkerAgentId: string; delegatingUserId: string; manifestActionId: string; argsJson: unknown };
  decisionRationale: unknown;
  onBehalf: boolean;
}): StandingRulingEligibility {
  const args = record(input.envelope.argsJson);
  const binding = record(args?.approvalBinding);
  if (!binding) return { eligible: false, reason: "not-an-authority-request" };
  if (input.onBehalf) return { eligible: false, reason: "decided-on-behalf" };
  if (
    binding.actingHumanUserId !== input.envelope.delegatingUserId
    || binding.actingAgentId !== input.envelope.coworkerAgentId
    || binding.toolName !== input.envelope.manifestActionId
  ) {
    return { eligible: false, reason: "binding-owner-mismatch" };
  }
  if (args?.proposeBoundary === true) return { eligible: false, reason: "raised-under-propose-boundary" };
  const rationale = record(input.decisionRationale);
  if (!rationale || typeof rationale.damaging !== "boolean") {
    return { eligible: false, reason: "decision-unrecorded" };
  }
  if (rationale.damaging) return { eligible: false, reason: "damaging" };
  if (rationale.escalationReason !== "unsteered-side-effect") {
    return { eligible: false, reason: "not-unsteered" };
  }
  return {
    eligible: true,
    actionClass: {
      coworkerAgentId: input.envelope.coworkerAgentId,
      toolName: input.envelope.manifestActionId,
      delegatingUserId: input.envelope.delegatingUserId,
    },
  };
}

export function buildStandingRuling(
  actionClass: StandingRulingActionClass,
  ruledBy: string,
  now: Date,
): StandingRuling {
  return {
    version: STANDING_RULING_VERSION,
    state: "active",
    actionClass,
    ruledBy,
    ruledAt: now.toISOString(),
  };
}

/** Parse a stored ruling. Anything malformed is no ruling, never a broad one. */
export function readStandingRuling(argsJson: unknown): StandingRuling | null {
  const ruling = record(record(argsJson)?.standingRuling);
  const actionClass = record(ruling?.actionClass);
  if (!ruling || !actionClass || ruling.version !== STANDING_RULING_VERSION) return null;
  if (ruling.state !== "active" && ruling.state !== "revoked") return null;
  const coworkerAgentId = text(actionClass.coworkerAgentId);
  const toolName = text(actionClass.toolName);
  const delegatingUserId = text(actionClass.delegatingUserId);
  const ruledBy = text(ruling.ruledBy);
  const ruledAt = text(ruling.ruledAt);
  if (!coworkerAgentId || !toolName || !delegatingUserId || !ruledBy || !ruledAt) return null;
  return {
    version: STANDING_RULING_VERSION,
    state: ruling.state,
    actionClass: { coworkerAgentId, toolName, delegatingUserId },
    ruledBy,
    ruledAt,
    ...(text(ruling.revokedBy) ? { revokedBy: ruling.revokedBy as string } : {}),
    ...(text(ruling.revokedAt) ? { revokedAt: ruling.revokedAt as string } : {}),
  };
}

/** Does this stored ruling cover this call's exact class, and still stand? */
export function rulingCovers(
  ruling: StandingRuling | null,
  call: { coworkerAgentIds: readonly string[]; toolName: string; delegatingUserId: string },
): boolean {
  return Boolean(
    ruling
    && ruling.state === "active"
    && ruling.ruledBy === ruling.actionClass.delegatingUserId
    && call.coworkerAgentIds.includes(ruling.actionClass.coworkerAgentId)
    && ruling.actionClass.toolName === call.toolName
    && ruling.actionClass.delegatingUserId === call.delegatingUserId,
  );
}

/** Plain words for the approver, by why a ruling could not be made. */
export function standingRulingRefusalText(reason: StandingRulingIneligibility): string {
  switch (reason) {
    case "decided-on-behalf":
      return "Only the owner can make an approval standing, so this one covers this request only.";
    case "damaging":
      return "This kind of action can reach outside, cannot be undone, or changes someone's access, so you will still be asked each time.";
    default:
      return "This approval covers this request only; it could not be made standing.";
  }
}
