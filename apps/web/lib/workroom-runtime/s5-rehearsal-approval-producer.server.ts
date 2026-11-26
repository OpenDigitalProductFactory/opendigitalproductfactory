import { randomBytes, randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";
import { z } from "zod";
import { APPROVAL_DECISION_WINDOW_MS } from "@/lib/coworker/approval-lifetime";
import { ensureAuthorityApprovalEnvelope } from "@/lib/coworker/authority-approval-envelope";
import { fingerprintCoworkerApprovalBinding, fingerprintCoworkerInput, type CoworkerApprovalBinding } from "@/lib/govern/authority/coworker-authority-decision";
import { computeParamHash } from "@/lib/gpp/param-hash";
import { canonicalPermitClaims, type PermitClaims } from "@/lib/gpp/permit-claims";
import { signPermit, verifyPermitMac, type PermitSignature } from "@/lib/gpp/permit-handle";
import { GPP_PERMIT_TTL_MS, newPermitId } from "@/lib/gpp/permit-mint";
import { persistGppPermit, type PermitRow } from "@/lib/gpp/permit-store";
import { getAgentGaidMap } from "@/lib/identity/principal-linking";
import { isRecord } from "@/lib/shared/coerce";
import { getToolGrantMapping, persistedAgentToolGrants } from "@/lib/tak/agent-grants";
import { COMMAND_ACCEPTED, commandPayloadBinding, runReceiptedCommand, type ReceiptDb } from "@/lib/work-capsules/command-receipts";
import { resolveAuthorityBindingEligibility } from "@/lib/work-management/coordinator-eligibility";
import { resolveAgentWorkroomAccess } from "@/lib/work-management/workroom-agent-access.server";
import { readStoredWorkroomDriveState } from "@/lib/work-management/workroom-drive-state";
import { readS5RehearsalApprover, readS5RehearsalDecision, type S5DecisionEnvelope } from "./s5-rehearsal-approver.server";
import { S5_REHEARSAL_APPROVAL_ACTION } from "./s5-rehearsal-approval-action";
import { s5ExactRehearsalAttempt, s5RehearsalAdmissionSnapshot } from "./s5-rehearsal-admission-snapshot.server";
import { previewIdentity, S5_REHEARSAL_READ_PATH, s5RehearsalApprovalParams, s5RehearsalOperations, s5RehearsalOwnerPin } from "./s5-rehearsal-owner.server";

const authority = s5RehearsalAdmissionSnapshot.shape.authority.omit({ permitRef: true });
const snapshot = s5RehearsalAdmissionSnapshot.omit({ qualification: true, expiresAt: true }).extend({ authority });
const reservationRef = z.string().regex(/^GPM-[0-9a-f-]{36}$/u);
export const reviewedS5RehearsalPins = s5RehearsalOwnerPin.pick({ leaseId: true, sourceSha: true, signingPublicKey: true, shapeRef: true }).extend({
  schemaVersion: z.literal("s5-rehearsal-approval-draft.v2"),
  approverPrincipalId: s5RehearsalAdmissionSnapshot.shape.qualification.shape.ownerPrincipalId,
  snapshot,
  operations: s5RehearsalOperations,
});
const requestShape = s5ExactRehearsalAttempt.extend({ reviewedPinDigest: z.string().regex(/^[a-f0-9]{64}$/u) });
const proposalScope = "s5-rehearsal-owner-approval";
const proposalType = "s5.rehearsal-approval.propose";
type ReviewedPins = z.infer<typeof reviewedS5RehearsalPins>;
type Locator = z.infer<typeof s5ExactRehearsalAttempt>;
type Current = { draft: unknown; approverUserId: string; approverPrincipalId: string; taskUserId: string; agentId: string; bindingRowId: string };
type PendingIntent = {
  params: ReturnType<typeof s5RehearsalApprovalParams>; binding: CoworkerApprovalBinding;
  bindingRowId: string; now: Date; deadline: Date; reviewedPinDigest: string;
};
const held = { kind: "held" } as const;
type Result = typeof held | { kind: "proposed"; envelopeId: string; permitRef: string; expiresAt: number };

export type S5RehearsalProducerPorts = {
  db: ReceiptDb;
  preview: { leaseId: string; sourceSha: string; origin?: string };
  locateRoom: (id: string) => Promise<string | null>;
  loadCurrent: (tx: ReceiptDb, id: string, attempt: Locator, userId: string) => Promise<Current | null>;
  readDecision: (tx: ReceiptDb, envelope: S5DecisionEnvelope, userId: string) => ReturnType<typeof readS5RehearsalDecision>;
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

async function readReviewedIntent(ports: S5RehearsalProducerPorts, tx: ReceiptDb, roomId: string, userId: string,
  attempt: Locator, reviewedPinDigest: string) {
  const current = await ports.loadCurrent(tx, roomId, attempt, userId);
  const value = reviewedS5RehearsalPins.safeParse(current?.draft);
  if (!value.success || !current || current.approverUserId !== userId || current.taskUserId === userId
    || current.approverPrincipalId !== value.data.approverPrincipalId) return null;
  const pin = value.data;
  const origins = ports.preview.origin ? [ports.preview.origin] : ["http://localhost:3001", "http://127.0.0.1:3001"];
  if (pin.leaseId !== ports.preview.leaseId || pin.sourceSha !== ports.preview.sourceSha
    || pin.snapshot.syntheticTarget.databaseRef !== `preview-db:${ports.preview.leaseId}`
    || !origins.some(origin => pin.snapshot.resource === origin + S5_REHEARSAL_READ_PATH)
    || s5RehearsalDraftDigest(pin) !== reviewedPinDigest
    || !Object.entries(attempt).every(([key, val]) => pin.snapshot[key as keyof Locator] === val)) return null;
  return { pin, current };
}

function bindApproval({ pin, current }: NonNullable<Awaited<ReturnType<typeof readReviewedIntent>>>,
  userId: string, permitRef: string, approvalExpiresAt: number) {
  const params = s5RehearsalApprovalParams({
    ...pin, approvalExpiresAt, snapshot: { ...pin.snapshot, authority: { ...pin.snapshot.authority, permitRef } },
  });
  const binding: CoworkerApprovalBinding = {
    // The exact attempt is in the fingerprint, but no TaskRun is eligible to resume on decision.
    actingHumanUserId: userId, actingAgentId: current.agentId, taskRunId: null,
    chainId: null, toolName: S5_REHEARSAL_APPROVAL_ACTION, subject: null, routeContext: "/build",
    inputFingerprint: fingerprintCoworkerInput(params), sensitivity: "internal",
    decisionVersionFingerprint: fingerprintCoworkerInput({ policy: "s5-rehearsal-approval.v2" }),
  };
  return { params, binding };
}

/** The durable Workroom command lock covers intent and receipt only. The caller
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
      let prepared: Awaited<ReturnType<typeof readReviewedIntent>> = null;
      const result = await runReceiptedCommand<Result>({
        db: ports.db, authorityScopeKey: proposalScope,
        commandId: commandPayloadBinding(attempt).digest, commandType: proposalType,
        target: { kind: "workroom", id: attempt.workroomId }, expectedRoomRowId: roomRowId,
        actor: { userId, agentId: null }, payloadBinding: commandPayloadBinding({ attempt, userId, reviewedPinDigest }),
        beforeReceiptRead: async (tx, lockedRowId) => {
          prepared = await readReviewedIntent(ports, tx, lockedRowId, userId, attempt, reviewedPinDigest);
          return !!prepared;
        },
        run: async (tx) => {
          if (!prepared) throw new Error("Current rehearsal pins are unavailable.");
          const { pin, current } = prepared;
          const proposedAt = now();
          const deadline = new Date(proposedAt.getTime() + APPROVAL_DECISION_WINDOW_MS);
          if (!(proposedAt < deadline)) throw new Error("Invalid approval clock.");
          const permitRef = reservationRef.parse(ports.reservePermitRef());
          const approval = bindApproval(prepared, userId, permitRef, deadline.getTime());
          const pending = await ports.raisePending(tx, { ...approval, bindingRowId: current.bindingRowId,
            now: proposedAt, deadline, reviewedPinDigest });
          if (pending.status !== "proposed" || !pending.envelopeId || !pending.authorityDecisionId
            || pending.expiresAt?.getTime() !== deadline.getTime() || !(now() < deadline)) throw new Error("No exact pending approval.");
          return { kind: "proposed", envelopeId: pending.envelopeId, permitRef, expiresAt: deadline.getTime() };
        },
      });
      return result.kind === "proposed" && now().getTime() < result.expiresAt ? result : held;
    } catch {
      return held;
    }
  };
}

async function hasOriginalProposal(tx: ReceiptDb, roomId: string, attempt: Locator, userId: string, reviewedPinDigest: string,
  envelopeId: string, permitRef: string, expiresAt: number): Promise<boolean> {
  const row = await tx.workroomActivity.findFirst?.({ where: { workCapsuleId: roomId, commandScopeKey: proposalScope,
    commandKey: commandPayloadBinding(attempt).digest }, select: { kind: true, payload: true } });
  if (row?.kind !== COMMAND_ACCEPTED || !isRecord(row.payload)) return false;
  const { target, commandType, payloadBinding, result } = row.payload;
  const expected = commandPayloadBinding({ attempt, userId, reviewedPinDigest });
  return commandType === proposalType && isRecord(target) && target.kind === "workroom" && target.id === attempt.workroomId
    && isRecord(payloadBinding) && payloadBinding.version === expected.version && payloadBinding.digest === expected.digest
    && isRecord(result) && result.kind === "proposed" && result.envelopeId === envelopeId && result.permitRef === permitRef
    && result.expiresAt === expiresAt;
}

/** The one decision CAS and linked permit commit together under the Workroom
 * lock. No issuer or reservation authority comes from the Inbox request. */
export function createS5RehearsalApprovalCommit(ports: S5RehearsalProducerPorts) {
  const now = ports.now ?? (() => new Date());
  return async <T extends { ok: boolean }>(envelope: S5DecisionEnvelope, userId: string, writeDecision: (tx: ReceiptDb) => Promise<T>): Promise<T | null> => {
    try {
      const located = await ports.readDecision(ports.db, envelope, userId);
      const attempt = s5ExactRehearsalAttempt.safeParse(located?.attempt);
      const permitRef = reservationRef.safeParse(located?.permitRef);
      const deadline = envelope.expiresAt;
      if (!located || !attempt.success || !permitRef.success || !deadline || !(now() < deadline)) return null;
      const roomId = await ports.locateRoom(attempt.data.workroomId);
      if (!roomId) return null;
      const decisionDigest = commandPayloadBinding(located).digest;
      let reviewed: Awaited<ReturnType<typeof readReviewedIntent>> = null;
      let approved: T | null = null;
      await runReceiptedCommand({
        db: ports.db, authorityScopeKey: "s5-rehearsal-owner-decision", commandId: envelope.id, commandType: "s5.rehearsal-approval.decide",
        target: { kind: "workroom", id: attempt.data.workroomId }, expectedRoomRowId: roomId,
        actor: { userId, agentId: null }, payloadBinding: commandPayloadBinding({ userId, decisionDigest, envelopeId: envelope.id }),
        beforeReceiptRead: async (tx, lockedRoomId) => {
          const current = await ports.readDecision(tx, envelope, userId);
          if (!current || commandPayloadBinding(current).digest !== decisionDigest) return false;
          reviewed = await readReviewedIntent(ports, tx, lockedRoomId, userId, attempt.data, current.reviewedPinDigest);
          if (!reviewed || current.approverPrincipalId !== reviewed.current.approverPrincipalId
            || current.bindingRowId !== reviewed.current.bindingRowId || !(now() < deadline)) return false;
          const { binding } = bindApproval(reviewed, userId, permitRef.data, deadline.getTime());
          const stored = envelope.argsJson;
          return binding.actingAgentId === envelope.coworkerAgentId && binding.inputFingerprint === envelope.inputFingerprint
            && fingerprintCoworkerApprovalBinding(binding) === envelope.approvalBindingFingerprint
            && isRecord(stored) && stored.proposeBoundary === true && !("humanApproval" in stored) && !("policyAuthority" in stored)
            && isRecord(stored.approvalBinding)
            && commandPayloadBinding(stored.approvalBinding).digest === commandPayloadBinding(binding).digest
            && await hasOriginalProposal(tx, lockedRoomId, attempt.data, userId, current.reviewedPinDigest,
              envelope.id, permitRef.data, deadline.getTime());
        },
        run: async (tx) => {
          if (!reviewed || !envelope.authorityDecisionId) throw new Error("Missing rehearsal decision binding.");
          const { current } = reviewed;
          const issuedAt = now();
          if (!(issuedAt < deadline)) throw new Error("Rehearsal approval window closed.");
          const decided = await writeDecision(tx);
          if (!decided.ok) throw new Error("Rehearsal decision did not win its compare-and-set.");
          const { params } = bindApproval(reviewed, userId, permitRef.data, deadline.getTime());
          const claims: PermitClaims = {
            permitId: permitRef.data, bindingId: S5_REHEARSAL_APPROVAL_ACTION, bindingVersion: 1, gateKey: S5_REHEARSAL_APPROVAL_ACTION,
            authority: "wwmd", shapeRef: params.shapeRef, stageKey: params.stageKey, gateDecisionId: null,
            authorityDecisionId: envelope.authorityDecisionId, envelopeId: envelope.id, actorGaid: params.subject.gaid,
            actorUserId: current.taskUserId, actorAgentId: current.agentId, workroomId: params.workroomId, subjectScope: params.stageAttemptRef,
            capabilities: params.operations.map(tool => ({ tool })), paramHash: computeParamHash(S5_REHEARSAL_APPROVAL_ACTION, params),
            enforcement: "enforced", notBefore: issuedAt, expiresAt: new Date(issuedAt.getTime() + GPP_PERMIT_TTL_MS),
            maxUses: 1, nonce: ports.nonce(), parentPermitId: null,
          };
          const signature = ports.sign(claims);
          if (!signature) throw new Error("Permit signing is unavailable.");
          const persisted = await ports.persistPermit(tx, claims, signature);
          if (persisted.enforcement !== "enforced" || canonicalPermitClaims(persisted) !== canonicalPermitClaims(claims)
            || persisted.useCount !== 0 || persisted.revokedAt !== null || !ports.verify(persisted) || !(now() < deadline)) {
            throw new Error("An exact enforced permit was not persisted in time.");
          }
          approved = decided;
          return { kind: "approved" };
        },
      });
      // An exact replay can observe the receipt but cannot approve again or mint another permit.
      return approved;
    } catch {
      return null;
    }
  };
}

export async function commitS5RehearsalApproval<T extends { ok: boolean }>(
  envelope: S5DecisionEnvelope, userId: string, write: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T | null> {
  const preview = previewIdentity(process.env);
  if (!preview) return null;
  const db = prisma as unknown as Pick<Prisma.TransactionClient, "workroom"> & ReceiptDb;
  return createS5RehearsalApprovalCommit({ ...s5RehearsalPreviewOwnerPorts(db), preview })(
    envelope, userId, tx => write(tx as unknown as Prisma.TransactionClient));
}

function approvalRationale({ params: p, deadline }: PendingIntent): string {
  const { recipient } = p.syntheticTarget;
  return [
    "Approve one synthetic CLI rehearsal attempt and at most one provider request, including retries and reconnects.",
    `Approving principal ${p.approverPrincipalId}; subject ${p.subject.principalId} (${p.subject.gaid}); Workroom ${p.workroomId}, session ${p.sessionRef}, stage ${p.stageKey}, attempt ${p.stageAttemptRef}.`,
    `Preview ${p.leaseId} at ${p.sourceSha}, DB ${p.syntheticTarget.databaseRef}; fixture ${p.syntheticTarget.fixtureRef}, case ${p.syntheticTarget.caseKey}, destination ${p.syntheticTarget.destinationRef}.`,
    `Data-only recipient (${recipient.authorityRef}, ${recipient.destinationRef}, ${recipient.reservationRef}). Control ${p.receiverRef} on ${p.hostRef} at ${p.resource}, key ${p.signingPublicKey}.`,
    `Issuer ${p.issuer}, origin ${p.originRef}, authority binding ${p.authority.bindingRef}, permit ${p.authority.permitRef}, grants ${p.authority.grantKeys.join(", ")}.`,
    `Work shape: ${p.shapeRef}. Operations: ${p.operations.map(op => op === "post_room_message" ? `${op} (write: record a quiet route proposal only)` : `${op} (read)`).join(", ")}.`,
    `Approve before ${deadline.toISOString()} on DPF's clock. If missed, this attempt is spent and cannot be reopened.`,
    "Execution is limited to 120 seconds from DPF admission after approval, and ends sooner if current authority expires.",
    "Only approval issues the linked permit. No send until the joined no-send proof passes. Approving here does not start or send.",
    "No production, v1, real data, API fallback, or paid overage. No standing approval, normal room messages, notifications, wake, or duplicate effects.",
  ].join("\n");
}

/** The only write adapter. The narrow ReceiptDb is the same Prisma
 * transaction object passed by the canonical Workroom command lifecycle. */
export function s5RehearsalPreviewOwnerPorts(db: Pick<Prisma.TransactionClient, "workroom"> & ReceiptDb) {
  const txOf = (tx: ReceiptDb) => tx as unknown as Prisma.TransactionClient;
  return {
    db,
    readDecision: (tx, envelope, userId) => readS5RehearsalDecision(txOf(tx), envelope, userId),
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
            approverPrincipalId: params.approverPrincipalId, reviewedPinDigest: intent.reviewedPinDigest,
            sessionRef: params.sessionRef, stageKey: params.stageKey, stageAttemptRef: params.stageAttemptRef },
        },
        select: { decisionId: true },
      });
      const envelope = await ensureAuthorityApprovalEnvelope({ binding, authorityDecisionId: decision.decisionId, threadId: null,
        explanation: approvalRationale(intent), proposeBoundary: true, now: intent.now, rehearsalApprovalDeadline: intent.deadline }, owner);
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
