import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { z } from "zod";
import { canonicalWorkroomToolName } from "@/lib/shared/workroom-tool-aliases";
import { isS5CoordinationOperation, type S5AdmissionCeiling } from "@/lib/workroom-runtime/s5-admission.server";

/** Defining the carrier does not admit it at the legacy bearer entrypoint. */
export const S5_WORKROOM_TOKEN_KIND = "workroom_session_scoped";
const S5_CREDENTIAL_VERSION = "s5-room-credential.v1";
const key = z.string().min(1).max(256).regex(/^\S+$/u);
const uniqueKeys = z.array(key).min(1).max(128).refine((names) => new Set(names).size === names.length);
const projection = z.strictObject({
  schemaVersion: z.literal(S5_CREDENTIAL_VERSION),
  workroomId: key,
  sessionRef: key,
  stageKey: key,
  stageAttemptRef: key,
  caseKey: key,
  issuer: key,
  audience: key,
  hostRef: key,
  worktreeRef: key.nullable(),
  mode: z.enum(["read-only-coordination", "bounded-coding"]),
  subject: z.strictObject({ principalId: key, gaid: key.regex(/^gaid:[^\s]+$/u) }),
  agentId: key,
  bindingRef: key,
  permitRef: key,
  activityKey: key,
  job: z.strictObject({ id: key, version: key }),
  jsi: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("not-applicable") }),
    z.strictObject({ kind: z.literal("eligible"), qualification: z.strictObject({ id: key, version: z.int().positive(), statusRevision: z.int().positive() }) }),
  ]),
  operationKeys: uniqueKeys.refine((names) => names.every((name) => canonicalWorkroomToolName(name) === name && /^[a-z][a-z0-9_.-]*$/u.test(name))),
}).refine((value) => value.mode === "read-only-coordination"
  ? value.worktreeRef === null && value.jsi.kind === "eligible" && value.operationKeys.every(isS5CoordinationOperation)
  : value.worktreeRef !== null);

type S5CredentialProjection = z.infer<typeof projection>;

/** Subset of McpApiToken data needed for the scope check; never include the bearer or hash. */
export type S5CredentialCarrier = {
  kind: string;
  workroomRef: string | null;
  runRef: string | null;
  agentId: string | null;
  scope: string;
  capability: string;
  resource: string | null;
  authorityBindingId: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  scopes: readonly string[];
  workroomAuthorization: unknown;
};

type AuthenticatedControl = { issuer: string; audience: string; hostRef: string; resource: string };
export type IssuedS5Ceiling = Readonly<{
  projection: S5CredentialProjection;
  authorityBindingId: string;
  expiresAt: Date;
  grantKeys: readonly string[];
}>;

/** Store exact references and the maximum operation set, not job or qualification records. */
export function captureS5CredentialCeiling(admission: S5AdmissionCeiling): S5CredentialProjection {
  return projection.parse({
    schemaVersion: S5_CREDENTIAL_VERSION,
    ...admission.locator,
    stageKey: admission.stageKey, caseKey: admission.caseKey,
    issuer: admission.issuer, audience: admission.host.receiverRef, hostRef: admission.host.hostRef,
    worktreeRef: admission.host.worktreeRef, mode: admission.host.mode,
    subject: admission.subject, agentId: admission.agentId,
    bindingRef: admission.bindingRef, permitRef: admission.permitRef, activityKey: admission.activityKey, job: admission.job,
    jsi: admission.jsi.kind === "eligible" ? { kind: "eligible", qualification: admission.jsi.qualification } : { kind: "not-applicable" },
    operationKeys: admission.operationKeys,
  });
}

/** The receiver is authenticated independently. This check does not decide current authority. */
export function readS5CredentialCeiling(row: S5CredentialCarrier, receiver: AuthenticatedControl, now: Date): IssuedS5Ceiling | null {
  const instant = now.getTime();
  if (row.kind !== S5_WORKROOM_TOKEN_KIND || row.scope !== "read" || row.capability !== "read"
    || !row.resource || row.resource !== receiver.resource || !row.authorityBindingId || row.revokedAt !== null
    || !Number.isFinite(instant) || !row.expiresAt || !(row.createdAt.getTime() <= instant && instant < row.expiresAt.getTime())) return null;
  const parsed = projection.safeParse(row.workroomAuthorization);
  const grants = uniqueKeys.safeParse(row.scopes);
  if (!parsed.success || !grants.success) return null;
  const value = parsed.data;
  if (value.workroomId !== row.workroomRef || value.sessionRef !== row.runRef || value.agentId !== row.agentId
    || value.issuer !== receiver.issuer || value.audience !== receiver.audience || value.hostRef !== receiver.hostRef) return null;
  return { projection: value, authorityBindingId: row.authorityBindingId, expiresAt: row.expiresAt, grantKeys: grants.data };
}

/** Intersect the issued ceiling and current admission. No stale binding, permit,
 * subject, attempt or qualification revision can be made current by replay. */
export function narrowS5CredentialForCurrentAdmission(issued: IssuedS5Ceiling, current: S5AdmissionCeiling, now: Date) {
  try {
    const instant = now.getTime();
    if (!(instant < issued.expiresAt.getTime()) || current.authorityBindingId !== issued.authorityBindingId
      || (current.jsi.kind === "eligible" && !(instant < current.jsi.validUntil))) return null;
    const { operationKeys: oldOperations, ...oldIdentity } = issued.projection;
    const { operationKeys: newOperations, ...newIdentity } = captureS5CredentialCeiling(current);
    if (canonicalJson(oldIdentity) !== canonicalJson(newIdentity)) return null;
    const currentOps = new Set(newOperations);
    const currentGrants = new Set(current.grantKeys);
    const operationKeys = oldOperations.filter((operation) => currentOps.has(operation));
    const grantKeys = issued.grantKeys.filter((grant) => currentGrants.has(grant));
    return operationKeys.length && grantKeys.length ? { operationKeys, grantKeys } : null;
  } catch {
    return null;
  }
}
