import { randomBytes, randomUUID } from "node:crypto";
import type { Prisma } from "@dpf/db";
import { z } from "zod";
import { ensureAuthorityApprovalEnvelope } from "@/lib/coworker/authority-approval-envelope";
import { fingerprintCoworkerInput, type CoworkerApprovalBinding } from "@/lib/govern/authority/coworker-authority-decision";
import { computeParamHash } from "@/lib/gpp/param-hash";
import { canonicalPermitClaims, type PermitClaims } from "@/lib/gpp/permit-claims";
import { signPermit, verifyPermitMac, type PermitSignature } from "@/lib/gpp/permit-handle";
import { newPermitId } from "@/lib/gpp/permit-mint";
import { persistGppPermit, type PermitRow } from "@/lib/gpp/permit-store";
import { getAgentGaidMap } from "@/lib/identity/principal-linking";
import { isRecord } from "@/lib/shared/coerce";
import { getToolGrantMapping, persistedAgentToolGrants } from "@/lib/tak/agent-grants";
import { commandPayloadBinding, runReceiptedCommand, type ReceiptDb } from "@/lib/work-capsules/command-receipts";
import { resolveAuthorityBindingEligibility } from "@/lib/work-management/coordinator-eligibility";
import { resolveAgentWorkroomAccess } from "@/lib/work-management/workroom-agent-access.server";
import { readStoredWorkroomDriveState } from "@/lib/work-management/workroom-drive-state";
import { readS5RehearsalApprover } from "./s5-rehearsal-approver.server";
import { S5_REHEARSAL_APPROVAL_ACTION } from "./s5-rehearsal-approval-action";
import { s5ExactRehearsalAttempt, s5RehearsalAdmissionSnapshot } from "./s5-rehearsal-admission-snapshot.server";
import { S5_REHEARSAL_READ_PATH, s5RehearsalApprovalParams, s5RehearsalOwnerPin } from "./s5-rehearsal-owner.server";

const authority = s5RehearsalAdmissionSnapshot.shape.authority.omit({ permitRef: true });
const snapshot = s5RehearsalAdmissionSnapshot.omit({ qualification: true, expiresAt: true }).extend({ authority });
const operation = z.enum(["get_workroom", "read_room_messages", "post_room_message"]);
export const reviewedS5RehearsalPins = s5RehearsalOwnerPin.pick({ leaseId: true, sourceSha: true, signingPublicKey: true, shapeRef: true }).extend({
  schemaVersion: z.literal("s5-rehearsal-approval-draft.v1"),
  approverPrincipalId: s5RehearsalAdmissionSnapshot.shape.qualification.shape.ownerPrincipalId,
  expiresAt: z.int().nonnegative(),
  snapshot,
  operations: z.array(operation).min(1).max(3).refine(keys => new Set(keys).size === keys.length),
});
const requestShape = s5ExactRehearsalAttempt.extend({ reviewedPinDigest: z.string().regex(/^[a-f0-9]{64}$/u) });
type ReviewedPins = z.infer<typeof reviewedS5RehearsalPins>;
type Locator = z.infer<typeof s5ExactRehearsalAttempt>;
type Current = { draft: unknown; approverUserId: string; approverPrincipalId: string; taskUserId: string; agentId: string; bindingRowId: string };
type PendingIntent = {
  params: ReturnType<typeof s5RehearsalApprovalParams>; binding: CoworkerApprovalBinding;
  bindingRowId: string; now: Date; deadline: Date;
};
const held = { kind: "held" } as const;
type Result = typeof held | { kind: "proposed"; envelopeId: string; permitRef: string; expiresAt: number };

export type S5RehearsalProducerPorts = {
  db: ReceiptDb;
  preview: { leaseId: string; sourceSha: string; origin: string };
  locateRoom: (id: string) => Promise<string | null>;
  loadCurrent: (tx: ReceiptDb, id: string, attempt: Locator, userId: string) => Promise<Current | null>;
  raisePending: (tx: ReceiptDb, intent: PendingIntent) => Promise<{
    envelopeId: string; status: string; expiresAt: Date | null; authorityDecisionId: string;
  }>;
  persistPermit: (tx: ReceiptDb, claims: PermitClaims, signature: PermitSignature) => Promise<PermitRow>;
  reservePermitRef: () => string;
  nonce: () => string;
  sign: (claims: PermitClaims) => PermitSignature | null;
  verify: (row: PermitRow) => boolean;
  now?: () => Date;
};

export const s5RehearsalDraftDigest = (draft: ReviewedPins): string => commandPayloadBinding(draft).digest;

/** The durable Workroom command lock covers all three writes. The caller
 * supplies only an exact locator and reviewed digest, never approval facts. */
export function createS5RehearsalApprovalProducer(ports: S5RehearsalProducerPorts) {
  const now = ports.now ?? (() => new Date());
  return async (userId: string, candidate: unknown): Promise<Result> => {
    const parsed = requestShape.safeParse(candidate);
    if (!userId || !parsed.success) return held;
    const { reviewedPinDigest, ...attempt } = parsed.data;
    try {
      const roomRowId = await ports.locateRoom(attempt.workroomId);
      if (!roomRowId) return held;
      const prepared: { pin?: ReviewedPins; current?: Current } = {};
      return await runReceiptedCommand<Result>({
        db: ports.db, authorityScopeKey: "s5-rehearsal-owner-approval",
        commandId: commandPayloadBinding(attempt).digest, commandType: "s5.rehearsal-approval.propose",
        target: { kind: "workroom", id: attempt.workroomId }, expectedRoomRowId: roomRowId,
        actor: { userId, agentId: null }, payloadBinding: commandPayloadBinding({ attempt, userId, reviewedPinDigest }),
        beforeReceiptRead: async (tx, lockedRowId) => {
          const current = await ports.loadCurrent(tx, lockedRowId, attempt, userId);
          const value = reviewedS5RehearsalPins.safeParse(current?.draft);
          if (!value.success || !current || current.approverUserId !== userId || current.taskUserId === userId
            || current.approverPrincipalId !== value.data.approverPrincipalId) return false;
          const pin = value.data;
          const time = now().getTime();
          if (pin.leaseId !== ports.preview.leaseId || pin.sourceSha !== ports.preview.sourceSha
            || pin.snapshot.syntheticTarget.databaseRef !== `preview-db:${ports.preview.leaseId}`
            || pin.snapshot.resource !== ports.preview.origin + S5_REHEARSAL_READ_PATH
            || s5RehearsalDraftDigest(pin) !== reviewedPinDigest
            || !Object.entries(attempt).every(([key, val]) => pin.snapshot[key as keyof Locator] === val)
            || !(time < pin.expiresAt && pin.expiresAt <= time + 120_000)) return false;
          prepared.pin = pin;
          prepared.current = current;
          return true;
        },
        run: async (tx) => {
          const { pin, current } = prepared;
          if (!pin || !current) throw new Error("Current rehearsal pins are unavailable.");
          const issuedAt = now();
          const deadline = new Date(pin.expiresAt);
          if (!(issuedAt < deadline)) throw new Error("Rehearsal expired.");
          const permitRef = ports.reservePermitRef();
          if (!/^GPM-[0-9a-f-]{36}$/u.test(permitRef)) throw new Error("Invalid permit reference.");
          const params = s5RehearsalApprovalParams({ ...pin, snapshot: { ...pin.snapshot, authority: { ...pin.snapshot.authority, permitRef } } });
          const binding: CoworkerApprovalBinding = {
            // The session remains in the exact input fingerprint. No TaskRun
            // may be resumed just because a human recorded this decision.
            actingHumanUserId: userId, actingAgentId: current.agentId, taskRunId: null,
            chainId: null, toolName: S5_REHEARSAL_APPROVAL_ACTION, subject: null, routeContext: "/build",
            inputFingerprint: fingerprintCoworkerInput(params), sensitivity: "internal",
            decisionVersionFingerprint: fingerprintCoworkerInput({ policy: "s5-rehearsal-approval.v1" }),
          };
          const pending = await ports.raisePending(tx, { params, binding, bindingRowId: current.bindingRowId, now: issuedAt, deadline });
          if (pending.status !== "proposed" || !pending.envelopeId || !pending.authorityDecisionId
            || pending.expiresAt?.getTime() !== pin.expiresAt || !(now() < deadline)) throw new Error("No exact pending approval.");
          const claims: PermitClaims = {
            permitId: permitRef, bindingId: S5_REHEARSAL_APPROVAL_ACTION, bindingVersion: 1, gateKey: S5_REHEARSAL_APPROVAL_ACTION,
            authority: "wwmd", shapeRef: pin.shapeRef, stageKey: attempt.stageKey, gateDecisionId: null,
            authorityDecisionId: pending.authorityDecisionId, envelopeId: pending.envelopeId, actorGaid: pin.snapshot.subject.gaid,
            actorUserId: current.taskUserId, actorAgentId: current.agentId, workroomId: attempt.workroomId, subjectScope: attempt.stageAttemptRef,
            capabilities: pin.operations.map(tool => ({ tool })), paramHash: computeParamHash(S5_REHEARSAL_APPROVAL_ACTION, params),
            enforcement: "enforced", notBefore: issuedAt, expiresAt: deadline, maxUses: 1, nonce: ports.nonce(), parentPermitId: null,
          };
          const signature = ports.sign(claims);
          if (!signature) throw new Error("Permit signing is unavailable.");
          const issued = await ports.persistPermit(tx, claims, signature);
          if (issued.enforcement !== "enforced" || canonicalPermitClaims(issued) !== canonicalPermitClaims(claims)
            || issued.useCount !== 0 || issued.revokedAt !== null || !ports.verify(issued) || !(now() < deadline)) {
            throw new Error("An exact enforced permit was not persisted.");
          }
          return { kind: "proposed", envelopeId: pending.envelopeId, permitRef, expiresAt: pin.expiresAt };
        },
      });
    } catch {
      return held;
    }
  };
}

function approvalRationale({ params: p, deadline }: PendingIntent): string {
  const { recipient } = p.syntheticTarget;
  return [
    "Approve one synthetic CLI rehearsal attempt and at most one provider request, including retries and reconnects.",
    `Approving principal ${p.approverPrincipalId}; subject ${p.subject.principalId} (${p.subject.gaid}); Workroom ${p.workroomId}, session ${p.sessionRef}, stage ${p.stageKey}, attempt ${p.stageAttemptRef}.`,
    `Preview ${p.leaseId} at ${p.sourceSha}, DB ${p.syntheticTarget.databaseRef}; fixture ${p.syntheticTarget.fixtureRef}, case ${p.syntheticTarget.caseKey}, destination ${p.syntheticTarget.destinationRef}.`,
    `Data-only recipient (${recipient.authorityRef}, ${recipient.destinationRef}, ${recipient.reservationRef}). Control ${p.receiverRef} on ${p.hostRef} at ${p.resource}, key ${p.signingPublicKey}.`,
    `Issuer ${p.issuer}, origin ${p.originRef}, authority binding ${p.authority.bindingRef}, permit ${p.authority.permitRef}, grants ${p.authority.grantKeys.join(", ")}.`,
    `Original DPF-clock deadline: ${deadline.toISOString()} (at most 120 seconds). No send until the joined no-send proof passes. Approving here does not start or send.`,
    "No production, v1, real data, API fallback, or paid overage. No standing approval, normal room messages, notifications, wake, or duplicate effects.",
  ].join("\n");
}

/** The only write adapter. The narrow ReceiptDb is the same Prisma
 * transaction object passed by the canonical Workroom command lifecycle. */
export function s5RehearsalPreviewOwnerPorts(db: Pick<Prisma.TransactionClient, "workroom"> & ReceiptDb) {
  const txOf = (tx: ReceiptDb) => tx as unknown as Prisma.TransactionClient;
  return {
    db,
    async locateRoom(workroomId) { return (await db.workroom.findUnique({ where: { capsuleId: workroomId }, select: { id: true } }))?.id ?? null; },
    async loadCurrent(tx, roomRowId, attempt, userId) {
      const owner = txOf(tx);
      const room = await owner.workroom.findUnique({ where: { id: roomRowId }, select: {
        capsuleId: true, status: true, archivedAt: true, workspaceState: true, requestedByPrincipalId: true,
        taskRun: { select: { taskRunId: true, currentAgentId: true, userId: true, status: true, archivedAt: true } },
      } });
      const task = room?.taskRun;
      if (!room || room.capsuleId !== attempt.workroomId || room.archivedAt || !["ready", "in-progress", "working"].includes(room.status)
        || !room.requestedByPrincipalId || !task?.currentAgentId || task.userId === userId
        || task.taskRunId !== attempt.sessionRef || task.archivedAt || !["submitted", "working"].includes(task.status)
        || !isRecord(room.workspaceState) || readStoredWorkroomDriveState(room.workspaceState).currentStageKey !== attempt.stageKey) return null;
      const parsed = reviewedS5RehearsalPins.safeParse(room.workspaceState.s5RehearsalApprovalDraft);
      if (!parsed.success) return null;
      const draft = parsed.data;
      const s = draft.snapshot;
      const [access, aliases, principal, agent, binding, user, approver] = await Promise.all([
        resolveAgentWorkroomAccess({ userId: task.userId, agentId: task.currentAgentId, workroomId: roomRowId, requested: "content" }, owner),
        getAgentGaidMap([task.currentAgentId], owner),
        owner.principal.findUnique({ where: { principalId: s.subject.principalId }, select: {
          aliases: { where: { aliasType: "gaid", issuer: "" }, take: 2, select: { aliasValue: true } },
        } }),
        owner.agent.findUnique({ where: { agentId: task.currentAgentId }, select: {
          id: true, status: true, archived: true, toolGrants: { select: { grantKey: true } }, toolGrantRevocations: { select: { grantKey: true } },
        } }),
        owner.authorityBinding.findUnique({ where: { bindingId: s.authority.bindingRef }, select: {
          id: true, status: true, scopeType: true, resourceType: true, resourceRef: true, appliedAgentId: true, grants: { select: { mode: true, grantKey: true } },
        } }),
        owner.user.findUnique({ where: { id: task.userId }, select: {
          isActive: true, automationVerificationId: true, automationProfile: true, automationSlot: true, automationExpiresAt: true,
        } }),
        readS5RehearsalApprover(owner, userId),
      ]);
      if (!approver || approver.id === room.requestedByPrincipalId || approver.principalId !== draft.approverPrincipalId
        || !user?.isActive || user.automationVerificationId !== null || user.automationProfile !== null || user.automationSlot !== null
        || user.automationExpiresAt !== null || !agent || agent.archived || agent.status !== "active" || !binding || binding.appliedAgentId !== agent.id
        || resolveAuthorityBindingEligibility(draft.shapeRef, [binding]) !== "eligible"
        || access.decision.level !== "content" || access.authorityContext?.humanPrincipal?.id !== room.requestedByPrincipalId
        || access.agentPrincipalId !== s.subject.principalId || aliases.get(task.currentAgentId) !== s.subject.gaid
        || principal?.aliases.length !== 1 || principal.aliases[0]?.aliasValue !== s.subject.gaid) return null;
      const grants = new Set(persistedAgentToolGrants(agent));
      const allowed = new Set(binding.grants.filter(g => g.mode === "allow").map(g => g.grantKey));
      const mapping = getToolGrantMapping();
      if (!s.authority.grantKeys.every(key => grants.has(key) && allowed.has(key))
        || !draft.operations.every(tool => mapping[tool]?.length && mapping[tool]!.every(key => s.authority.grantKeys.includes(key)))) return null;
      return { draft, approverUserId: approver.userId, approverPrincipalId: approver.principalId,
        taskUserId: task.userId, agentId: task.currentAgentId, bindingRowId: binding.id };
    },
    async raisePending(tx, intent) {
      const owner = txOf(tx);
      const { binding, params } = intent;
      const decision = await owner.authorizationDecisionLog.create({
        data: {
          decisionId: `AUTH-${randomUUID()}`, actorType: "human", actorRef: binding.actingHumanUserId,
          humanContextRef: binding.actingHumanUserId, agentContextRef: binding.actingAgentId, authorityBindingId: intent.bindingRowId,
          actionKey: S5_REHEARSAL_APPROVAL_ACTION, objectRef: params.workroomId, decision: "require-approval",
          purposeOfUse: "synthetic-rehearsal-approval-request", mode: "proposal", sensitivityLevel: binding.sensitivity,
          rationale: { inputFingerprint: binding.inputFingerprint, permitRef: params.authority.permitRef,
            approverPrincipalId: params.approverPrincipalId, sessionRef: params.sessionRef },
        },
        select: { decisionId: true },
      });
      const envelope = await ensureAuthorityApprovalEnvelope({ binding, authorityDecisionId: decision.decisionId, threadId: null,
        explanation: approvalRationale(intent), proposeBoundary: true, now: intent.now, rehearsalDeadline: intent.deadline }, owner);
      const stored = await owner.coworkerActionEnvelope.findUnique({ where: { id: envelope.id }, select: {
        status: true, expiresAt: true, resolvedAt: true, authorityDecisionId: true, inputFingerprint: true,
        manifestActionId: true, delegatingUserId: true, coworkerAgentId: true,
      } });
      if (!stored || stored.status !== "proposed" || stored.resolvedAt !== null
        || stored.authorityDecisionId !== decision.decisionId || stored.inputFingerprint !== binding.inputFingerprint
        || stored.manifestActionId !== S5_REHEARSAL_APPROVAL_ACTION
        || stored.delegatingUserId !== binding.actingHumanUserId || stored.coworkerAgentId !== binding.actingAgentId) {
        throw new Error("Pending envelope did not retain the exact governed binding.");
      }
      return { envelopeId: envelope.id, status: stored.status, expiresAt: stored.expiresAt, authorityDecisionId: decision.decisionId };
    },
    persistPermit: (tx, claims, signature) => persistGppPermit(txOf(tx), claims, signature),
    reservePermitRef: newPermitId,
    nonce: () => randomBytes(16).toString("hex"),
    sign: signPermit,
    verify: row => verifyPermitMac(row, null).result === "ok",
  } satisfies Omit<S5RehearsalProducerPorts, "preview">;
}
