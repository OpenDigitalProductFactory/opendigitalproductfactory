import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { z } from "zod";
import type { Prisma } from "@dpf/db";
import { readS5CredentialCeiling, S5_WORKROOM_TOKEN_KIND } from "@/lib/auth/s5-room-credential.server";
import { verifyIdentityStatement } from "@/lib/federation/instance-identity";
import { fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";
import { verifyPermitMac } from "@/lib/gpp/permit-handle";
import { computeParamHash } from "@/lib/gpp/param-hash";
import { readGppPermitForEvidence } from "@/lib/gpp/permit-store";
import { getAgentGaidMap } from "@/lib/identity/principal-linking";
import { isRecord } from "@/lib/shared/coerce";
import { getToolGrantMapping, persistedAgentToolGrants } from "@/lib/tak/agent-grants";
import { resolveAuthorityBindingEligibility } from "@/lib/work-management/coordinator-eligibility";
import { resolveAgentWorkroomAccess } from "@/lib/work-management/workroom-agent-access.server";
import { readStoredWorkroomDriveState } from "@/lib/work-management/workroom-drive-state";
import { readS5RehearsalApprover } from "./s5-rehearsal-approver.server";
import { verifyS5RehearsalQualification } from "./s5-rehearsal-qualification.server";
import { S5_REHEARSAL_APPROVAL_ACTION } from "./s5-rehearsal-approval-action";
import { createS5RehearsalAdmissionReader, s5ExactRehearsalAttempt, s5RehearsalAdmissionSnapshot,
  type S5RehearsalAdmissionReadPorts } from "./s5-rehearsal-admission-snapshot.server";

export const S5_REHEARSAL_READ_PATH = "/api/internal/s5-rehearsal-admission";
const MAX_PROOF_MS = 15_000;
const ref = z.string().min(1).max(256).regex(/^\S+$/u);
const sha = z.string().regex(/^[a-f0-9]{40}$/u);
export const s5RehearsalOperations = z.array(z.enum(["get_workroom", "read_room_messages", "post_room_message"]))
  .min(1).max(3).refine(keys => new Set(keys).size === keys.length);
export const s5RehearsalOwnerPin = z.strictObject({
  schemaVersion: z.literal("s5-rehearsal-owner.v1"),
  leaseId: ref, sourceSha: sha, status: z.literal("active"),
  signingPublicKey: z.string().regex(/^[A-Za-z0-9+/]{59}=$/u),
  tokenId: ref, shapeRef: ref, qualificationRecord: z.record(z.string(), z.unknown()),
  snapshot: s5RehearsalAdmissionSnapshot,
});
export type S5RehearsalOwnerPin = z.infer<typeof s5RehearsalOwnerPin>;
type Attempt = z.infer<typeof s5ExactRehearsalAttempt>;
type Receiver = NonNullable<Awaited<ReturnType<S5RehearsalAdmissionReadPorts["authenticate"]>>>;

type OwnerReads = {
  readOwnerPin: (attempt: Attempt) => Promise<unknown>;
  readCurrent: (pin: S5RehearsalOwnerPin, now: Date) => Promise<unknown>;
};

/** The approved call is exact, including the 1-request/120s limits and receiver.
 * This only names a governed approval shape. The read route does not create,
 * approve, execute or reserve the envelope. */
export function s5RehearsalApprovalParams(pin: Pick<S5RehearsalOwnerPin, "leaseId" | "sourceSha" | "signingPublicKey" | "shapeRef"> & {
  snapshot: Omit<S5RehearsalOwnerPin["snapshot"], "qualification" | "expiresAt">; approverPrincipalId: string;
  operations: z.infer<typeof s5RehearsalOperations>; expiresAt: number;
}) {
  const { snapshot: s } = pin;
  return { purpose: S5_REHEARSAL_APPROVAL_ACTION, requestLimit: 1, attemptLimit: 1, deadlineMs: 120_000, profile: s.profile,
    leaseId: pin.leaseId, sourceSha: pin.sourceSha, receiverRef: s.receiverRef, hostRef: s.hostRef, resource: s.resource,
    signingPublicKey: pin.signingPublicKey, originRef: s.originRef, authority: s.authority,
    issuer: s.issuer, workroomId: s.workroomId, sessionRef: s.sessionRef, stageKey: s.stageKey, stageAttemptRef: s.stageAttemptRef,
    subject: s.subject, approverPrincipalId: pin.approverPrincipalId, syntheticTarget: s.syntheticTarget,
    shapeRef: pin.shapeRef, operations: pin.operations, expiresAt: pin.expiresAt };
}

/** The private Workroom attempt pin locates records; it does not establish
 * current authority. Re-read persisted owner rows, never repair missing facts. */
export function createS5RehearsalOwnerReads(tx: Prisma.TransactionClient): OwnerReads {
  const rooms = new Map<string, Awaited<ReturnType<typeof readRoom>>>();
  function readRoom(workroomId: string) {
    return tx.workroom.findUnique({ where: { capsuleId: workroomId }, select: {
      id: true, status: true, archivedAt: true, workspaceState: true, requestedByPrincipalId: true,
      taskRun: { select: { taskRunId: true, status: true, archivedAt: true, userId: true, currentAgentId: true } },
    } });
  }
  return {
    async readOwnerPin(attempt) {
      const room = await readRoom(attempt.workroomId);
      if (!room || room.archivedAt !== null || !["ready", "in-progress", "working"].includes(room.status)
        || !room.taskRun || room.taskRun.archivedAt !== null || !["submitted", "working"].includes(room.taskRun.status)
        || room.taskRun.taskRunId !== attempt.sessionRef || !isRecord(room.workspaceState)
        || readStoredWorkroomDriveState(room.workspaceState).currentStageKey !== attempt.stageKey) return null;
      rooms.set(attempt.workroomId, room);
      return room.workspaceState.s5RehearsalAdmission;
    },
    async readCurrent(pin, now) {
      const s = pin.snapshot;
      const room = rooms.get(s.workroomId);
      const task = room?.taskRun;
      if (!room || !task?.currentAgentId || !room.requestedByPrincipalId) return null;
      const [row, envelope, agent, permit, principal] = await Promise.all([
        tx.mcpApiToken.findFirst({ where: { id: pin.tokenId, kind: S5_WORKROOM_TOKEN_KIND }, select: {
          kind: true, workroomRef: true, runRef: true, agentId: true, userId: true, scope: true, capability: true, resource: true,
          authorityBindingId: true, createdAt: true, expiresAt: true, revokedAt: true, scopes: true, workroomAuthorization: true,
        } }),
        tx.coworkerActionEnvelope.findUnique({ where: { id: s.qualification.approvalRef } }),
        tx.agent.findUnique({ where: { agentId: task.currentAgentId }, select: {
          id: true, status: true, archived: true, toolGrants: { select: { grantKey: true } }, toolGrantRevocations: { select: { grantKey: true } },
        } }),
        readGppPermitForEvidence(tx, s.authority.permitRef),
        tx.principal.findUnique({ where: { principalId: s.subject.principalId }, select: {
          id: true, kind: true, status: true, aliases: { where: { aliasType: "gaid", issuer: "" }, take: 2, select: { aliasValue: true } },
        } }),
      ]);
      const t = now.getTime();
      if (!row || row.userId !== task.userId || row.agentId !== task.currentAgentId || !agent || agent.status !== "active" || agent.archived
        || principal?.status !== "active" || principal.kind !== "agent" || principal.aliases.length !== 1
        || principal.aliases[0]?.aliasValue !== s.subject.gaid) return null;
      const credential = readS5CredentialCeiling(row, { issuer: s.issuer, audience: s.receiverRef, hostRef: s.hostRef, resource: s.resource }, now);
      const projected = credential?.projection;
      if (!projected || credential.expiresAt.getTime() !== s.expiresAt || s.expiresAt > row.createdAt.getTime() + 120_000
        || projected.workroomId !== s.workroomId || projected.sessionRef !== s.sessionRef || projected.stageKey !== s.stageKey
        || projected.stageAttemptRef !== s.stageAttemptRef || projected.jsi.kind !== "rehearsal-qualification"
        || canonicalJson(projected.subject) !== canonicalJson(s.subject)
        || canonicalJson(projected.jsi.syntheticTarget) !== canonicalJson(s.syntheticTarget)
        || projected.bindingRef !== s.authority.bindingRef || projected.permitRef !== s.authority.permitRef) return null;
      const marker = isRecord(envelope?.argsJson) ? envelope.argsJson.humanApproval : null;
      const approvalTime = isRecord(marker) && typeof marker.approvedAt === "string" ? Date.parse(marker.approvedAt) : Number.NaN;
      if (!envelope || envelope.status !== "approved" || envelope.resolvedAt !== null || envelope.manifestActionId !== S5_REHEARSAL_APPROVAL_ACTION
        || envelope.delegatingUserId === task.userId || envelope.coworkerAgentId !== task.currentAgentId || !envelope.approvalBindingFingerprint
        || !envelope.expiresAt || !envelope.authorityDecisionId || !isRecord(marker) || Object.keys(marker).length !== 2
        || marker.userId !== envelope.delegatingUserId || !(approvalTime > 0 && approvalTime <= t)) return null;
      if (!permit || verifyPermitMac(permit, null).result !== "ok" || permit.enforcement !== "enforced" || permit.revokedAt !== null
        || permit.envelopeId !== envelope.id || permit.authorityDecisionId !== envelope.authorityDecisionId
        || permit.bindingId !== S5_REHEARSAL_APPROVAL_ACTION || permit.subjectScope !== s.stageAttemptRef
        || permit.workroomId !== s.workroomId || permit.stageKey !== s.stageKey || permit.shapeRef !== pin.shapeRef
        || permit.actorAgentId !== task.currentAgentId || permit.actorUserId !== task.userId || permit.actorGaid !== s.subject.gaid
        || permit.maxUses !== 1 || permit.useCount !== 0 || !(permit.notBefore.getTime() <= t && t < permit.expiresAt.getTime())
        || permit.expiresAt.getTime() !== envelope.expiresAt.getTime() || s.expiresAt > permit.expiresAt.getTime()
        || !projected.operationKeys.every(key => permit.capabilities.some(c => c.tool === key))) return null;
      const operations = s5RehearsalOperations.safeParse(permit.capabilities.map(c => c.tool));
      if (!operations.success) return null;
      const params = s5RehearsalApprovalParams({ ...pin, approverPrincipalId: s.qualification.ownerPrincipalId,
        operations: operations.data, expiresAt: permit.expiresAt.getTime() });
      if (envelope.inputFingerprint !== fingerprintCoworkerInput(params)
        || permit.paramHash !== computeParamHash(S5_REHEARSAL_APPROVAL_ACTION, params)) return null;
      const [binding, access, aliases, taskUser, approver] = await Promise.all([
        tx.authorityBinding.findUnique({ where: { id: credential.authorityBindingId }, select: {
          bindingId: true, status: true, resourceRef: true, resourceType: true, scopeType: true, appliedAgentId: true,
          grants: { select: { grantKey: true, mode: true } },
        } }),
        resolveAgentWorkroomAccess({ userId: task.userId, agentId: task.currentAgentId, workroomId: room.id, requested: "content" }, tx),
        getAgentGaidMap([task.currentAgentId], tx),
        tx.user.findUnique({ where: { id: task.userId }, select: {
          isActive: true, automationVerificationId: true, automationProfile: true, automationSlot: true, automationExpiresAt: true,
        } }),
        readS5RehearsalApprover(tx, envelope.delegatingUserId),
      ]);
      if (!taskUser?.isActive || taskUser.automationVerificationId !== null || taskUser.automationProfile !== null
        || taskUser.automationSlot !== null || taskUser.automationExpiresAt !== null
        || !approver || approver.id === room.requestedByPrincipalId || approver.principalId !== s.qualification.ownerPrincipalId
        || !binding || binding.bindingId !== s.authority.bindingRef || binding.appliedAgentId !== agent.id
        || resolveAuthorityBindingEligibility(pin.shapeRef, [binding]) !== "eligible"
        || access.decision.level !== "content" || access.authorityContext?.humanPrincipal?.id !== room.requestedByPrincipalId
        || access.agentPrincipalId !== s.subject.principalId
        || aliases.get(task.currentAgentId) !== s.subject.gaid) return null;
      const grants = new Set(persistedAgentToolGrants(agent));
      const granted = new Set(binding.grants.filter(g => g.mode === "allow").map(g => g.grantKey));
      const grantKeys = credential.grantKeys.filter(key => grants.has(key) && granted.has(key));
      const registry = getToolGrantMapping();
      if (!projected.operationKeys.every(key => registry[key]?.length && registry[key]!.every(grant => grantKeys.includes(grant)))) return null;
      const exact = { issuer: s.issuer, workroomId: s.workroomId, sessionRef: s.sessionRef, stageKey: s.stageKey,
        stageAttemptRef: s.stageAttemptRef, subject: s.subject, syntheticTarget: s.syntheticTarget };
      const qualification = verifyS5RehearsalQualification({ record: pin.qualificationRecord, approval: {
        purpose: S5_REHEARSAL_APPROVAL_ACTION, status: "approved", ref: envelope.id, ownerPrincipalId: approver.principalId,
        revision: approvalTime, binding: exact, validUntil: Math.min(envelope.expiresAt.getTime(), permit.expiresAt.getTime()),
      } }, exact, t);
      if (!qualification || qualification.approvalRef !== projected.jsi.approvalRef
        || qualification.approvalRevision !== projected.jsi.approvalRevision || qualification.statusRevision !== projected.jsi.statusRevision
        || qualification.ownerPrincipalId !== projected.jsi.ownerPrincipalId) return null;
      const { syntheticTarget, ...qualificationRef } = qualification;
      return { ...s, qualification: qualificationRef, syntheticTarget, authority: { ...s.authority, grantKeys } };
    },
  };
}
export type S5RehearsalOwnerPorts = {
  env: Readonly<Record<string, string | undefined>>;
  /** Use one consistent database snapshot for both reads. No provision or repair. */
  withOwnerRead: (read: (owner: OwnerReads) => Promise<Response>) => Promise<Response>;
  now?: () => Date;
};

export function previewIdentity(env: S5RehearsalOwnerPorts["env"]) {
  if (env.DPF_ENVIRONMENT !== "dev" || env.DPF_ENVIRONMENT_CLASS !== "development") return null;
  const leaseId = ref.safeParse(env.DPF_PREVIEW_LEASE_ID);
  const sourceSha = sha.safeParse(env.DPF_PREVIEW_SOURCE_SHA);
  if (!leaseId.success || !sourceSha.success || !env.DATABASE_URL) return null;
  const db = new URL(env.DATABASE_URL);
  if (db.protocol !== "postgresql:" || db.host !== "dev-postgres:5432" || db.pathname !== "/dpf" || db.search || db.hash) return null;
  return { leaseId: leaseId.data, sourceSha: sourceSha.data };
}

export function s5RehearsalReadStatement(receiver: Receiver, attempt: Attempt, leaseId: string, sourceSha: string, expiresAt: number): string {
  return canonicalJson({ purpose: "dpf.s5.rehearsal.admission.read.v1", method: "GET", receiver, attempt, leaseId, sourceSha, expiresAt });
}

const makeResponse = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const held = () => makeResponse({ kind: "held" }, 404);

/** Read-only internal route. A Control key is registered by the governed
 * preview owner for one exact admission, never obtained from request bytes. */
export function createS5RehearsalOwnerHandler(ports: S5RehearsalOwnerPorts) {
  const now = ports.now ?? (() => new Date());
  return async (request: Request): Promise<Response> => {
    try {
      const preview = previewIdentity(ports.env);
      if (!preview || request.method !== "GET" || request.url.length > 2_048) return held();
      const url = new URL(request.url);
      if (url.pathname !== S5_REHEARSAL_READ_PATH || !["http://localhost:3001", "http://127.0.0.1:3001"].includes(url.origin)) return held();
      const params = [...url.searchParams];
      if (params.length !== 4 || new Set(params.map(([name]) => name)).size !== 4) return held();
      const lookup = s5ExactRehearsalAttempt.safeParse(Object.fromEntries(params));
      const proof = request.headers.get("x-dpf-s5-proof");
      const until = request.headers.get("x-dpf-s5-proof-until");
      if (!lookup.success || !proof || !/^[A-Za-z0-9+/]{86}==$/u.test(proof) || !until || !/^\d{1,16}$/u.test(until)) return held();
      const expiresAt = Number(until);
      const fresh = () => {
        const remaining = expiresAt - now().getTime();
        return Number.isSafeInteger(expiresAt) && remaining > 0 && remaining <= MAX_PROOF_MS;
      };
      if (!fresh()) return held();
      return await ports.withOwnerRead(async (owner) => {
        const parsed = s5RehearsalOwnerPin.safeParse(await owner.readOwnerPin(lookup.data));
        if (!parsed.success) return held();
        const pin = parsed.data;
        const { issuer, receiverRef, hostRef, resource } = pin.snapshot;
        const receiver = { issuer, receiverRef, hostRef, resource };
        if (pin.leaseId !== preview.leaseId || pin.sourceSha !== preview.sourceSha || resource !== url.origin + url.pathname
          || pin.snapshot.syntheticTarget.databaseRef !== `preview-db:${preview.leaseId}`
          || !Object.entries(lookup.data).every(([name, value]) => pin.snapshot[name as keyof Attempt] === value)
          || !fresh() || !verifyIdentityStatement(pin.signingPublicKey,
            s5RehearsalReadStatement(receiver, lookup.data, preview.leaseId, preview.sourceSha, expiresAt), proof)) return held();
        const read = createS5RehearsalAdmissionReader({
          authenticate: async () => receiver,
          readEvidence: async () => ({ active: true, pinned: pin.snapshot, current: await owner.readCurrent(pin, now()) }),
          now,
        });
        const result = await read(request, lookup.data);
        return result.kind === "observed" && fresh() ? makeResponse(result, 200) : held();
      });
    } catch {
      return held();
    }
  };
}
