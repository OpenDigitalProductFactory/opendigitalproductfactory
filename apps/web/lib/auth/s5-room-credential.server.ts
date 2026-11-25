import type { Prisma } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { z } from "zod";
import { canonicalWorkroomToolName } from "@/lib/shared/workroom-tool-aliases";
import { isS5CoordinationActivity, isS5CoordinationOperation, type S5AdmissionCeiling, type S5AttemptLocator } from "@/lib/workroom-runtime/s5-admission.server";
import { s5RehearsalQualificationRef, s5SyntheticTarget } from "@/lib/workroom-runtime/s5-rehearsal-qualification.server";
import { createWorkroomSessionBearer, hashWorkroomSessionBearer, isGeneratedWorkroomSessionBearer, S5_WORKROOM_TOKEN_KIND } from "./workroom-session-token";

/** Defining the carrier does not admit it at the legacy bearer entrypoint. */
export { S5_WORKROOM_TOKEN_KIND };
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
    s5RehearsalQualificationRef.extend({ syntheticTarget: s5SyntheticTarget }),
  ]),
  operationKeys: uniqueKeys.refine((names) => names.every((name) => canonicalWorkroomToolName(name) === name && /^[a-z][a-z0-9_.-]*$/u.test(name))),
}).refine((value) => value.mode === "read-only-coordination"
  ? isS5CoordinationActivity(value.activityKey) && value.worktreeRef === null && value.jsi.kind !== "not-applicable"
    && (value.jsi.kind !== "rehearsal-qualification" || value.jsi.syntheticTarget.caseKey === value.caseKey)
    && value.operationKeys.every(isS5CoordinationOperation)
  : !isS5CoordinationActivity(value.activityKey) && value.worktreeRef !== null && value.jsi.kind !== "rehearsal-qualification");

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

export type S5AuthenticatedControl = { issuer: string; audience: string; hostRef: string; resource: string };
export type IssuedS5Ceiling = Readonly<{
  projection: S5CredentialProjection;
  authorityBindingId: string;
  expiresAt: Date;
  grantKeys: readonly string[];
}>;

/** Store exact references and the maximum operation set, not job or qualification records. */
export function captureS5CredentialCeiling(admission: S5AdmissionCeiling): S5CredentialProjection {
  const { jsi } = admission;
  const qualification = jsi.kind === "rehearsal-qualification"
    ? { kind: jsi.kind, approvalRef: jsi.approvalRef, ownerPrincipalId: jsi.ownerPrincipalId, statusRevision: jsi.statusRevision,
        approvalRevision: jsi.approvalRevision, syntheticTarget: jsi.syntheticTarget }
    : jsi.kind === "eligible" ? { kind: jsi.kind, qualification: jsi.qualification } : { kind: jsi.kind };
  return projection.parse({
    schemaVersion: S5_CREDENTIAL_VERSION,
    ...admission.locator,
    stageKey: admission.stageKey, caseKey: admission.caseKey,
    issuer: admission.issuer, audience: admission.host.receiverRef, hostRef: admission.host.hostRef,
    worktreeRef: admission.host.worktreeRef, mode: admission.host.mode,
    subject: admission.subject, agentId: admission.agentId,
    bindingRef: admission.bindingRef, permitRef: admission.permitRef, activityKey: admission.activityKey, job: admission.job,
    jsi: qualification,
    operationKeys: admission.operationKeys,
  });
}

/** The receiver is authenticated independently. This check does not decide current authority. */
export function readS5CredentialCeiling(row: S5CredentialCarrier, receiver: S5AuthenticatedControl, now: Date): IssuedS5Ceiling | null {
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

/** Prepare private launch credentials inside the admission owner's transaction.
 * Only the `data` goes to McpApiToken. The plaintext is for the current
 * authenticated Control connection, not a launch projection or replay receipt. */
export function prepareS5ControlCredential(input: {
  admission: S5AdmissionCeiling;
  receiver: S5AuthenticatedControl;
  userId: string;
  now: Date;
  /** Absolute expiry independently bounded by the owning stage permit. */
  expiresAt: Date;
  executionProfile?: "synthetic-rehearsal";
}) {
  try {
    const { admission, receiver, userId, now } = input;
    if (input.executionProfile !== undefined && input.executionProfile !== "synthetic-rehearsal") return null;
    if ((input.executionProfile === "synthetic-rehearsal") !== (admission.jsi.kind === "rehearsal-qualification")) return null;
    const ceiling = captureS5CredentialCeiling(admission);
    const jsiEnd = admission.jsi.kind !== "not-applicable" ? admission.jsi.validUntil : input.expiresAt.getTime();
    const expiresAt = new Date(Math.min(input.expiresAt.getTime(), jsiEnd));
    const plaintext = createWorkroomSessionBearer();
    const carrier = {
      kind: S5_WORKROOM_TOKEN_KIND, workroomRef: ceiling.workroomId, runRef: ceiling.sessionRef, agentId: ceiling.agentId,
      scope: "read", capability: "read", resource: receiver.resource, authorityBindingId: admission.authorityBindingId,
      createdAt: now, expiresAt, scopes: [...admission.grantKeys], workroomAuthorization: ceiling,
    };
    if (typeof userId !== "string" || !userId || userId.trim() !== userId
      || !key.safeParse(receiver.resource).success || !readS5CredentialCeiling({ ...carrier, revokedAt: null }, receiver, now)) return null;
    const data = { ...carrier, userId, name: `scoped room:${ceiling.workroomId}`, tokenHash: hashWorkroomSessionBearer(plaintext),
      prefix: plaintext.slice(0, 12), tokenSuffix: plaintext.slice(-4) } satisfies Prisma.McpApiTokenUncheckedCreateInput;
    return { plaintext, data };
  } catch {
    return null;
  }
}

const s5CarrierSelect = {
  id: true, userId: true, kind: true, workroomRef: true, runRef: true, agentId: true, scope: true, capability: true,
  resource: true, authorityBindingId: true, createdAt: true, expiresAt: true, revokedAt: true, scopes: true, workroomAuthorization: true,
} satisfies Prisma.McpApiTokenSelect;

/** Protected broker only. Use the locked transaction and confirm current
 * admission separately. This lookup does not write, slide or grant anything. */
export async function resolveS5ControlCredential(
  tx: { mcpApiToken: { findUnique: (args: { where: { tokenHash: string }; select: typeof s5CarrierSelect }) => Promise<(S5CredentialCarrier & { id: string; userId: string }) | null> } },
  plaintext: string,
  receiver: S5AuthenticatedControl,
  now: Date,
) {
  try {
    if (!isGeneratedWorkroomSessionBearer(plaintext)) return null;
    const row = await tx.mcpApiToken.findUnique({ where: { tokenHash: hashWorkroomSessionBearer(plaintext) }, select: s5CarrierSelect });
    if (!row?.id || !row.userId) return null;
    const ceiling = readS5CredentialCeiling(row, receiver, now);
    return ceiling ? { tokenId: row.id, userId: row.userId, ceiling } : null;
  } catch {
    return null;
  }
}

/** The runtime calls this in the owning Workroom transaction, with the token
 * identity it pinned at issuance. A retry cannot touch a successor or sibling. */
export async function revokeS5ControlCredential(
  tx: { mcpApiToken: { updateMany: (args: Prisma.McpApiTokenUpdateManyArgs) => Promise<{ count: number }> } },
  input: S5AttemptLocator & {
    tokenId: string;
    now: Date;
    reason: "attempt-released" | "launch-failed" | "executor-replaced" | "workroom-closed";
  },
): Promise<number> {
  if (![input.tokenId, input.workroomId, input.sessionRef, input.stageAttemptRef].every(value => key.safeParse(value).success)
    || !Number.isFinite(input.now.getTime())) throw new Error("Exact S5 credential identity is required for revocation.");
  const result = await tx.mcpApiToken.updateMany({
    where: {
      id: input.tokenId, kind: S5_WORKROOM_TOKEN_KIND, workroomRef: input.workroomId, runRef: input.sessionRef, revokedAt: null,
      AND: [
        { workroomAuthorization: { path: ["stageAttemptRef"], equals: input.stageAttemptRef } },
        { workroomAuthorization: { path: ["schemaVersion"], equals: S5_CREDENTIAL_VERSION } },
      ],
    },
    data: { revokedAt: input.now, revokedReason: input.reason },
  });
  return result.count;
}

/** Intersect the issued ceiling and current admission. No stale binding, permit,
 * subject, attempt or qualification revision can be made current by replay. */
export function narrowS5CredentialForCurrentAdmission(issued: IssuedS5Ceiling, current: S5AdmissionCeiling, now: Date) {
  try {
    const instant = now.getTime();
    if (!(instant < issued.expiresAt.getTime()) || current.authorityBindingId !== issued.authorityBindingId
      || (current.jsi.kind !== "not-applicable" && !(instant < current.jsi.validUntil))) return null;
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
