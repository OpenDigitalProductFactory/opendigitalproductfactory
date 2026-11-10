import { isRecord } from "@/lib/shared/coerce";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

// The operator pre-authorisation under which the Workroom drive lets an agent
// run role:author delivery stages (BI-8A32EBFF, AC-3). Operator decision of
// 2026-10-07: "all shapes, within budget" — agents may run any stage of any
// delivery shape up to the work's funded budget, escalating only on damaging
// actions or missing authority. The funding half lives in author-stage-autonomy.ts.
//
// Same record pattern as the acceptance sweep's close authorisation
// (BI-45D3BBF4): one PlatformConfig row recording who set it, when, why and its
// scope; a revocation keeps that provenance and adds its own; nothing deletes
// the row. Absent (the shipped default), revoked, malformed or out of scope, it
// is not in force and the drive raises attention as before, saying which.
//
// Checked at every drive run against current state: the operator who recorded
// it must still be active and hold manage_platform. A pre-authorisation is never
// stronger than the person behind it.

export const AUTHOR_STAGE_PREAUTHORISATION_CONFIG_KEY = "workroom-drive.author-stage-preauthorisation";
export const AUTHOR_STAGE_PREAUTHORISATION_SCOPE = "all-delivery-shapes-within-budget";
export const MIN_PREAUTHORISATION_REASON_LENGTH = 12;

export type AuthorStagePreauthorisationRecord = {
  schemaVersion: 1;
  scope: string;
  enabled: boolean;
  setByUserId: string;
  setAt: string;
  reason: string;
  revokedByUserId?: string;
  revokedAt?: string;
  revokeReason?: string;
};

export type AuthorStagePreauthorisation =
  | { state: "in-force"; setByUserId: string; setAt: string; reason: string }
  | { state: "not-in-force"; because: string };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The stored value, or null when it is not a complete record. */
export function parseAuthorStagePreauthorisation(value: unknown): AuthorStagePreauthorisationRecord | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.enabled !== "boolean") return null;
  const setByUserId = text(value.setByUserId);
  const setAt = text(value.setAt);
  const reason = text(value.reason);
  const scope = text(value.scope);
  if (!setByUserId || !setAt || !reason || !scope || Number.isNaN(Date.parse(setAt))) return null;
  const revokedByUserId = text(value.revokedByUserId);
  const revokedAt = text(value.revokedAt);
  const revokeReason = text(value.revokeReason);
  return {
    schemaVersion: 1, scope, enabled: value.enabled, setByUserId, setAt, reason,
    ...(revokedByUserId ? { revokedByUserId } : {}),
    ...(revokedAt ? { revokedAt } : {}),
    ...(revokeReason ? { revokeReason } : {}),
  };
}

export type AuthorStagePreauthorisationPorts = {
  readConfig(key: string): Promise<unknown>;
  /** Whether the user is active and currently holds manage_platform. */
  operatorMayAuthorise(userId: string): Promise<boolean>;
};

export async function resolveAuthorStagePreauthorisation(
  ports: AuthorStagePreauthorisationPorts,
): Promise<AuthorStagePreauthorisation> {
  const key = AUTHOR_STAGE_PREAUTHORISATION_CONFIG_KEY;
  const raw = await ports.readConfig(key);
  if (raw === null || raw === undefined) {
    return { state: "not-in-force", because: `No operator pre-authorisation is recorded (${key}).` };
  }
  const record = parseAuthorStagePreauthorisation(raw);
  if (!record) {
    return { state: "not-in-force", because: `The recorded pre-authorisation (${key}) is incomplete: it must say who set it, when, why and its scope.` };
  }
  if (record.scope !== AUTHOR_STAGE_PREAUTHORISATION_SCOPE) {
    return { state: "not-in-force", because: `The recorded pre-authorisation has scope "${record.scope}", not "${AUTHOR_STAGE_PREAUTHORISATION_SCOPE}".` };
  }
  if (!record.enabled) {
    const who = record.revokedByUserId ?? record.setByUserId;
    const when = record.revokedAt ?? record.setAt;
    return { state: "not-in-force", because: `The pre-authorisation was revoked by ${who} at ${when}${record.revokeReason ? `: ${record.revokeReason}` : ""}.` };
  }
  if (!(await ports.operatorMayAuthorise(record.setByUserId))) {
    return {
      state: "not-in-force",
      because: `The operator who recorded the pre-authorisation (${record.setByUserId}) is no longer active or no longer holds manage_platform.`,
    };
  }
  return { state: "in-force", setByUserId: record.setByUserId, setAt: record.setAt, reason: record.reason };
}

export function grantAuthorStagePreauthorisationRecord(input: { userId: string; reason: string; now: Date }): AuthorStagePreauthorisationRecord {
  return {
    schemaVersion: 1,
    scope: AUTHOR_STAGE_PREAUTHORISATION_SCOPE,
    enabled: true,
    setByUserId: input.userId,
    setAt: input.now.toISOString(),
    reason: input.reason.trim(),
  };
}

export function revokeAuthorStagePreauthorisationRecord(
  current: AuthorStagePreauthorisationRecord,
  input: { userId: string; reason: string; now: Date },
): AuthorStagePreauthorisationRecord {
  return { ...current, enabled: false, revokedByUserId: input.userId, revokedAt: input.now.toISOString(), revokeReason: input.reason.trim() };
}

export type AuthorStagePreauthorisationDb = {
  platformConfig: {
    findUnique(args: { where: { key: string }; select: { value: true } }): Promise<{ value: unknown } | null>;
    upsert(args: {
      where: { key: string };
      create: { key: string; value: AuthorStagePreauthorisationRecord };
      update: { value: AuthorStagePreauthorisationRecord };
    }): Promise<unknown>;
  };
};

/** The governed writer. The capability check lives in the server action; this takes the authorised operator id. */
export async function writeAuthorStagePreauthorisation(
  db: AuthorStagePreauthorisationDb,
  input: { action: "grant" | "revoke"; userId: string; reason: string; now: Date },
): Promise<ActionResult<AuthorStagePreauthorisationRecord>> {
  if (input.reason.trim().length < MIN_PREAUTHORISATION_REASON_LENGTH) {
    return err(`Say why in at least ${MIN_PREAUTHORISATION_REASON_LENGTH} characters; the reason is kept with the record.`);
  }
  const key = AUTHOR_STAGE_PREAUTHORISATION_CONFIG_KEY;
  let record: AuthorStagePreauthorisationRecord;
  if (input.action === "grant") {
    record = grantAuthorStagePreauthorisationRecord(input);
  } else {
    const current = parseAuthorStagePreauthorisation((await db.platformConfig.findUnique({ where: { key }, select: { value: true } }))?.value);
    if (!current || !current.enabled) return err("There is no pre-authorisation in force to revoke.");
    record = revokeAuthorStagePreauthorisationRecord(current, input);
  }
  await db.platformConfig.upsert({ where: { key }, create: { key, value: record }, update: { value: record } });
  return ok(record);
}
