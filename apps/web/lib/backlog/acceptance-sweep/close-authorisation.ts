import { isRecord } from "@/lib/shared/coerce";

// The operator pre-authorisation the acceptance sweep closes items under
// (BI-45D3BBF4, AC-1).
// Design: docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md §3.6.
//
// One PlatformConfig row, keyed below. It records who set it, when, why and
// its scope, and a revocation records who revoked it, when and why: the row is
// never deleted, so the history of the decision stays readable. With the row
// absent, revoked, malformed, or out of scope, the sweep closes nothing and
// says which.
//
// The authorisation is checked again at every run, against current state: the
// operator who recorded it must still be active and still hold manage_backlog
// (the closure runs in their human context), and the sweep's coworker must
// still hold a grant that permits the completion transition. An authorisation
// is never stronger than the people and grants behind it.

export const CLOSE_AUTHORISATION_CONFIG_KEY = "acceptance-sweep.close-authorisation";
export const CLOSE_AUTHORISATION_SCOPE = "close-when-gate-allows";
/** Closures per run when the authorisation names no bound. */
export const DEFAULT_CLOSE_LIMIT = 25;
/** The largest bound an authorisation may set. A run never closes more than it evaluated either. */
export const MAX_CLOSE_LIMIT = 100;
/** The tool whose grant mapping decides whether a coworker may perform the completion transition. */
export const COMPLETION_TRANSITION_TOOL = "update_backlog_item_status";

export type CloseAuthorisationRecord = {
  schemaVersion: 1;
  scope: typeof CLOSE_AUTHORISATION_SCOPE;
  enabled: boolean;
  setByUserId: string;
  setAt: string;
  reason: string;
  maxClosuresPerRun: number;
  revokedByUserId?: string;
  revokedAt?: string;
  revokeReason?: string;
};

export type CloseDisabledReason =
  | "not-recorded"
  | "malformed"
  | "out-of-scope"
  | "revoked"
  | "operator-not-authorised"
  | "agent-not-granted"
  /** The authorisation or the authority behind it could not be read this run. */
  | "unavailable";

export type CloseAuthorisation =
  | {
      state: "enabled";
      setByUserId: string;
      setAt: string;
      reason: string;
      limit: number;
      /** The grant that satisfied the completion transition's mapping, cited in the authority snapshot. */
      agentGrant: string;
    }
  | { state: "disabled"; reason: CloseDisabledReason; because: string };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function clampCloseLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return DEFAULT_CLOSE_LIMIT;
  return Math.min(value, MAX_CLOSE_LIMIT);
}

/** Parse the stored value. Anything that is not a complete record reads as null. */
export function parseCloseAuthorisation(value: unknown): CloseAuthorisationRecord | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.enabled !== "boolean") return null;
  const setByUserId = text(value.setByUserId);
  const setAt = text(value.setAt);
  const reason = text(value.reason);
  const scope = text(value.scope);
  if (!setByUserId || !setAt || !reason || !scope || Number.isNaN(Date.parse(setAt))) return null;
  return {
    schemaVersion: 1,
    scope: scope as typeof CLOSE_AUTHORISATION_SCOPE,
    enabled: value.enabled,
    setByUserId,
    setAt,
    reason,
    maxClosuresPerRun: clampCloseLimit(value.maxClosuresPerRun),
    ...(text(value.revokedByUserId) ? { revokedByUserId: text(value.revokedByUserId)! } : {}),
    ...(text(value.revokedAt) ? { revokedAt: text(value.revokedAt)! } : {}),
    ...(text(value.revokeReason) ? { revokeReason: text(value.revokeReason)! } : {}),
  };
}

export type CloseAuthorisationPorts = {
  readConfig(key: string): Promise<unknown>;
  /** Whether the user is active and currently holds manage_backlog. */
  operatorMayCloseBacklog(userId: string): Promise<boolean>;
  /** The grant that permits the completion transition for this coworker, or null when none does. */
  agentCompletionGrant(agentId: string): Promise<string | null>;
};

export async function resolveCloseAuthorisation(
  agentId: string,
  ports: CloseAuthorisationPorts,
): Promise<CloseAuthorisation> {
  const raw = await ports.readConfig(CLOSE_AUTHORISATION_CONFIG_KEY);
  if (raw === null || raw === undefined) {
    return {
      state: "disabled",
      reason: "not-recorded",
      because: `No operator pre-authorisation is recorded (${CLOSE_AUTHORISATION_CONFIG_KEY}); the sweep closes nothing.`,
    };
  }
  const record = parseCloseAuthorisation(raw);
  if (!record) {
    return {
      state: "disabled",
      reason: "malformed",
      because: `The recorded pre-authorisation (${CLOSE_AUTHORISATION_CONFIG_KEY}) is incomplete: it must say who set it, when, why and its scope.`,
    };
  }
  if (record.scope !== CLOSE_AUTHORISATION_SCOPE) {
    return {
      state: "disabled",
      reason: "out-of-scope",
      because: `The recorded pre-authorisation has scope "${record.scope}", not "${CLOSE_AUTHORISATION_SCOPE}".`,
    };
  }
  if (!record.enabled) {
    const who = record.revokedByUserId ?? record.setByUserId;
    const when = record.revokedAt ?? record.setAt;
    return {
      state: "disabled",
      reason: "revoked",
      because: `The pre-authorisation was revoked by ${who} at ${when}${record.revokeReason ? `: ${record.revokeReason}` : ""}.`,
    };
  }
  if (!(await ports.operatorMayCloseBacklog(record.setByUserId))) {
    return {
      state: "disabled",
      reason: "operator-not-authorised",
      because: `The operator who recorded the pre-authorisation (${record.setByUserId}) is no longer active or no longer holds manage_backlog.`,
    };
  }
  const agentGrant = await ports.agentCompletionGrant(agentId);
  if (!agentGrant) {
    return {
      state: "disabled",
      reason: "agent-not-granted",
      because: `${agentId} holds no grant that permits ${COMPLETION_TRANSITION_TOOL}; nothing is closed and no grant is assumed.`,
    };
  }
  return {
    state: "enabled",
    setByUserId: record.setByUserId,
    setAt: record.setAt,
    reason: record.reason,
    limit: record.maxClosuresPerRun,
    agentGrant,
  };
}

/** The record an operator grant writes. */
export function grantCloseAuthorisationRecord(input: {
  userId: string;
  reason: string;
  now: Date;
  maxClosuresPerRun?: number;
}): CloseAuthorisationRecord {
  return {
    schemaVersion: 1,
    scope: CLOSE_AUTHORISATION_SCOPE,
    enabled: true,
    setByUserId: input.userId,
    setAt: input.now.toISOString(),
    reason: input.reason.trim(),
    maxClosuresPerRun: clampCloseLimit(input.maxClosuresPerRun),
  };
}

/** The record a revocation writes: the grant's provenance stays, the revocation's is added. */
export function revokeCloseAuthorisationRecord(
  current: CloseAuthorisationRecord,
  input: { userId: string; reason: string; now: Date },
): CloseAuthorisationRecord {
  return {
    ...current,
    enabled: false,
    revokedByUserId: input.userId,
    revokedAt: input.now.toISOString(),
    revokeReason: input.reason.trim(),
  };
}
