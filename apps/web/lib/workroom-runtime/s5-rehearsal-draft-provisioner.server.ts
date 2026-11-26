import type { z } from "zod";
import { commandPayloadBinding, runReceiptedCommand, type ReceiptDb } from "@/lib/work-capsules/command-receipts";
import { reviewedS5RehearsalPins, s5RehearsalDraftDigest } from "./s5-rehearsal-approval-producer.server";
import { s5ExactRehearsalAttempt } from "./s5-rehearsal-admission-snapshot.server";

type Attempt = z.infer<typeof s5ExactRehearsalAttempt>;
type Draft = z.infer<typeof reviewedS5RehearsalPins>;
type SetupKey = { rulingRef: string; reservationId: string };
type Person = { principalId: string; userId: string };
type Preview = { installationId: string; leaseId: string; databaseId: string; sourceSha: string };
type Reservation = Attempt & SetupKey & { leaseId: string; status: "active" | "approved" | "spent" };
type Actor = Person & { agentId: string; leaseId: string };
type RollbackTarget = Attempt & SetupKey & Person;
type OwnerProof = RollbackTarget & { receiptId: string };
type Revocation = OwnerProof & {
  credentialRevoked: boolean; delegationRevoked: boolean; sessionsTerminated: boolean; readBackAt: number;
};
type Retirement = OwnerProof & { userRetired: boolean; retiredAt: number };
type Completion = OwnerProof & { revocationReceiptId: string; retirementReceiptId: string; completedAt: number };
type Compensation = (target: RollbackTarget) => Promise<boolean>;

export type S5RehearsalDraftProvisionerPorts = {
  db: ReceiptDb;
  // Remote owner observations are collected outside all local locks. The
  // reservation owner must fence replacement/teardown through the local commit.
  readInstallationProof(attempt: Attempt): Promise<(Preview & { environment: "production" | "non-production" }) | null>;
  readLeaseReservation(attempt: Attempt): Promise<(Preview & Attempt) | null>;
  readOneShotReservation(attempt: Attempt): Promise<Reservation | null>;
  // Only return a server-authenticated coworker with current delegated access
  // matching the canonical lease owner, not an identity from the command input.
  readInvoker(attempt: Attempt): Promise<Actor | null>;
  locateRoom(attempt: Attempt): Promise<string | null>;
  // The same connection used for the effect. Use BI-5C193A3F's positive identity
  // proof here, not a copied row or a configured database name.
  readDatabaseIdentity(tx: ReceiptDb, preview: Preview): Promise<string | null>;
  // Before the room row lock. Lock shared owner rows in order, including
  // insertion/revocation fences where locking observed rows alone is insufficient.
  lockOwnerRows(tx: ReceiptDb, attempt: Attempt, reservation: Reservation): Promise<boolean>;
  readEnrollmentReceipt(tx: ReceiptDb, attempt: Attempt): Promise<(Partial<Attempt & SetupKey> & Person & { fixtureRef: string }) | null>;
  readRequesterAuthority(tx: ReceiptDb, person: Person): Promise<(Person & {
    principalKind: string; localUserAlias: string | null; active: boolean;
    superuser: boolean; automation: boolean; delegationCurrent: boolean;
  }) | null>;
  // Must resolve the installation owner's current explicit capability.
  readApproverAuthority(tx: ReceiptDb, attempt: Attempt): Promise<(Person & { managePlatform: boolean }) | null>;
  // Verify current exact attempt, live room/task and assignment; stage alone is insufficient.
  readCurrentRoleLinks(tx: ReceiptDb, roomRowId: string, attempt: Attempt): Promise<{
    requestedByPrincipalId: string; taskUserId: string;
  } | null>;
  // Compose from current owner-verified pins (fixture, receiver, subject,
  // destination, grants and exact attempt). Never accept a caller-supplied draft.
  readReviewedDraft(tx: ReceiptDb, attempt: Attempt): Promise<unknown>;
  readStoredDraft(tx: ReceiptDb, roomRowId: string): Promise<unknown>;
  // Patch only workspaceState.s5RehearsalApprovalDraft on the exact locked
  // row, preserving other state. Must use tx, never a default client.
  writeDraft(tx: ReceiptDb, roomRowId: string, draft: Draft): Promise<boolean>;
  // Atomically authenticate, fence and quarantine the exact persisted setup.
  // Cross-owner compensations below are separate, idempotent checked operations.
  quarantineAttempt(attempt: Attempt): Promise<RollbackTarget | null>;
  closeWorkroom: Compensation;
  cancelTaskRun: Compensation;
  releaseLease: Compensation;
  fileOperatorRequest: Compensation;
  readOwnerRevocation(target: RollbackTarget): Promise<Revocation | null>;
  readOwnerRetirement(target: RollbackTarget, revocationReceiptId: string): Promise<Retirement | null>;
  readRollbackCompletion(target: RollbackTarget): Promise<Completion | null>;
};

const noProof = async () => null;
const noEffect = async () => false;
export const unservedS5RehearsalDraftProvisionerPorts: Readonly<S5RehearsalDraftProvisionerPorts> = Object.freeze({
  db: { workroomActivity: { create: async () => { throw new Error("Unserved receipt writer."); } } },
  readInstallationProof: noProof, readLeaseReservation: noProof, readOneShotReservation: noProof,
  readInvoker: noProof, locateRoom: noProof, readDatabaseIdentity: noProof, lockOwnerRows: noEffect,
  readEnrollmentReceipt: noProof, readRequesterAuthority: noProof, readApproverAuthority: noProof,
  readCurrentRoleLinks: noProof, readReviewedDraft: noProof, readStoredDraft: noProof, writeDraft: noEffect,
  quarantineAttempt: noProof, closeWorkroom: noEffect, cancelTaskRun: noEffect, releaseLease: noEffect,
  fileOperatorRequest: noEffect, readOwnerRevocation: noProof, readOwnerRetirement: noProof, readRollbackCompletion: noProof,
});

const held = { kind: "held" } as const;
const scope = "s5-rehearsal-provisioner";
const commandType = "s5.rehearsal-draft.provision";
const isRef = (value: string) => typeof value === "string" && /^\S{1,256}$/u.test(value);
const validTime = (value: number) => Number.isSafeInteger(value) && value >= 0;
const sameAttempt = (a: Partial<Attempt>, b: Attempt) => a.workroomId === b.workroomId
  && a.sessionRef === b.sessionRef && a.stageKey === b.stageKey && a.stageAttemptRef === b.stageAttemptRef;
const sameSetup = (a: Partial<SetupKey>, b: SetupKey) => a.rulingRef === b.rulingRef && a.reservationId === b.reservationId;
const samePerson = (a: Person, b: Person) => a.principalId === b.principalId && a.userId === b.userId;
const samePreview = (a: Preview, b: Preview) => a.installationId === b.installationId
  && a.leaseId === b.leaseId && a.databaseId === b.databaseId && a.sourceSha === b.sourceSha;
const exactProof = (proof: OwnerProof, target: RollbackTarget) =>
  isRef(proof.receiptId) && sameAttempt(proof, target) && sameSetup(proof, target) && samePerson(proof, target);

type Provisioned = { kind: "provisioned"; draftDigest: string; bindingDigest: string };
type ProvisionResult = typeof held | Provisioned;
type RollbackResult = typeof held | { kind: "rolled-back"; receiptId: string };

async function readLocalDraft(ports: S5RehearsalDraftProvisionerPorts, tx: ReceiptDb, roomRowId: string,
  attempt: Attempt, reservation: Reservation, preview: Preview, actor: Actor) {
  const enrollment = await ports.readEnrollmentReceipt(tx, attempt);
  if (!enrollment || !sameAttempt(enrollment, attempt) || !sameSetup(enrollment, reservation)
    || ![enrollment.principalId, enrollment.userId, enrollment.fixtureRef].every(isRef)) return null;
  const requester = await ports.readRequesterAuthority(tx, { principalId: enrollment.principalId, userId: enrollment.userId });
  const approver = await ports.readApproverAuthority(tx, attempt);
  const links = await ports.readCurrentRoleLinks(tx, roomRowId, attempt);
  if (!requester || !samePerson(requester, enrollment) || requester.localUserAlias !== enrollment.userId
    || requester.principalKind !== "human" || requester.active !== true || requester.superuser !== false
    || requester.automation !== false || requester.delegationCurrent !== true
    || !approver || approver.managePlatform !== true || ![approver.principalId, approver.userId].every(isRef)
    || approver.principalId === enrollment.principalId || approver.userId === enrollment.userId
    || approver.principalId === actor.principalId || enrollment.principalId === actor.principalId
    || links?.requestedByPrincipalId !== enrollment.principalId || links.taskUserId !== enrollment.userId) return null;
  const parsed = reviewedS5RehearsalPins.safeParse(await ports.readReviewedDraft(tx, attempt));
  if (!parsed.success) return null;
  const draft = parsed.data;
  if (!sameAttempt(draft.snapshot, attempt) || draft.approverPrincipalId !== approver.principalId
    || draft.leaseId !== preview.leaseId || draft.sourceSha !== preview.sourceSha
    || draft.snapshot.subject.principalId === actor.principalId
    || draft.snapshot.syntheticTarget.databaseRef !== preview.databaseId
    || draft.snapshot.syntheticTarget.fixtureRef !== enrollment.fixtureRef) return null;
  return { draft, requester: { principalId: requester.principalId, userId: requester.userId }, approver };
}

export function createS5RehearsalDraftProvisioner(ports: S5RehearsalDraftProvisionerPorts = unservedS5RehearsalDraftProvisionerPorts) {
  return {
    async provision(input: unknown): Promise<ProvisionResult> {
      const parsed = s5ExactRehearsalAttempt.safeParse(input);
      if (!parsed.success) return held;
      const attempt = parsed.data;
      try {
        const installation = await ports.readInstallationProof(attempt);
        const lease = await ports.readLeaseReservation(attempt);
        const reservation = await ports.readOneShotReservation(attempt);
        const actor = await ports.readInvoker(attempt);
        const roomRowId = await ports.locateRoom(attempt);
        if (!installation || installation.environment !== "non-production"
          || ![installation.installationId, installation.leaseId, installation.databaseId].every(isRef)
          || !/^[0-9a-f]{40}$/u.test(installation.sourceSha)
          || !lease || !samePreview(lease, installation) || !sameAttempt(lease, attempt)
          || !reservation || reservation.status !== "active" || !sameAttempt(reservation, attempt)
          || reservation.leaseId !== lease.leaseId || ![reservation.rulingRef, reservation.reservationId].every(isRef)
          || !actor || actor.leaseId !== lease.leaseId || ![actor.agentId, actor.principalId, actor.userId].every(isRef)
          || !roomRowId) return held;
        const setup = { rulingRef: reservation.rulingRef, reservationId: reservation.reservationId };
        const preview = { installationId: lease.installationId, leaseId: lease.leaseId, databaseId: lease.databaseId, sourceSha: lease.sourceSha };
        const payloadBinding = commandPayloadBinding({ ...attempt, ...setup, ...preview,
          invoker: { agentId: actor.agentId, principalId: actor.principalId, userId: actor.userId } });
        let prepared: { draft: Draft; result: Provisioned; hadDraft: boolean } | undefined;
        let wrote = false;
        const result = await runReceiptedCommand<Provisioned>({
          db: ports.db, authorityScopeKey: scope, commandType,
          commandId: commandPayloadBinding({ rulingRef: setup.rulingRef, ...attempt }).digest,
          target: { kind: "workroom", id: attempt.workroomId }, expectedRoomRowId: roomRowId,
          actor: { userId: actor.userId, agentId: actor.agentId }, payloadBinding,
          beforeRoomLock: async tx => {
            if (await ports.readDatabaseIdentity(tx, preview) !== preview.databaseId
              || await ports.lockOwnerRows(tx, attempt, reservation) !== true) throw new Error("Unverified preview write fence.");
          },
          beforeReceiptRead: async (tx, lockedRowId) => {
            const current = await readLocalDraft(ports, tx, lockedRowId, attempt, reservation, preview, actor);
            if (!current) return false;
            const stored: unknown = await ports.readStoredDraft(tx, lockedRowId);
            const draftDigest = s5RehearsalDraftDigest(current.draft);
            const hadDraft = stored != null;
            if (hadDraft && commandPayloadBinding(stored).digest !== draftDigest) return false;
            prepared = { draft: current.draft, hadDraft, result: {
              kind: "provisioned", draftDigest,
              bindingDigest: commandPayloadBinding({ ...setup, ...preview, ...attempt, requester: current.requester,
                approver: { principalId: current.approver.principalId, userId: current.approver.userId }, draftDigest }).digest,
            }};
            return true;
          },
          run: async tx => {
            if (!prepared || prepared.hadDraft || await ports.writeDraft(tx, roomRowId, prepared.draft) !== true) {
              throw new Error("Exact draft was not written.");
            }
            wrote = true;
            return prepared.result;
          },
        });
        if (!prepared || (!wrote && !prepared.hadDraft) || result?.kind !== "provisioned"
          || result.draftDigest !== prepared.result.draftDigest || result.bindingDigest !== prepared.result.bindingDigest) return held;
        return prepared.result;
      } catch {
        return held;
      }
    },
    async rollback(input: unknown): Promise<RollbackResult> {
      const parsed = s5ExactRehearsalAttempt.safeParse(input);
      if (!parsed.success) return held;
      try {
        const target = await ports.quarantineAttempt(parsed.data);
        if (!target || !sameAttempt(target, parsed.data)
          || ![target.rulingRef, target.reservationId, target.userId, target.principalId].every(isRef)) return held;
        if (await ports.closeWorkroom(target) !== true || await ports.cancelTaskRun(target) !== true
          || await ports.releaseLease(target) !== true || await ports.fileOperatorRequest(target) !== true) return held;
        const revocation = await ports.readOwnerRevocation(target);
        if (!revocation || !exactProof(revocation, target) || revocation.credentialRevoked !== true
          || revocation.delegationRevoked !== true || revocation.sessionsTerminated !== true || !validTime(revocation.readBackAt)) return held;
        const retirement = await ports.readOwnerRetirement(target, revocation.receiptId);
        if (!retirement || !exactProof(retirement, target) || retirement.userRetired !== true
          || !validTime(retirement.retiredAt) || retirement.retiredAt <= revocation.readBackAt
          || retirement.receiptId === revocation.receiptId) return held;
        const completion = await ports.readRollbackCompletion(target);
        if (!completion || !exactProof(completion, target) || completion.revocationReceiptId !== revocation.receiptId
          || completion.retirementReceiptId !== retirement.receiptId
          || completion.receiptId === revocation.receiptId || completion.receiptId === retirement.receiptId
          || !validTime(completion.completedAt) || completion.completedAt < retirement.retiredAt) return held;
        return { kind: "rolled-back", receiptId: completion.receiptId };
      } catch {
        return held;
      }
    },
  };
}
