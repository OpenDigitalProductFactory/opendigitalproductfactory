import { randomUUID } from "node:crypto";
import { isRecord } from "@/lib/shared/coerce";
import { commandAuthorityScopeKey, commandPayloadBinding } from "./command-receipts";
import type { ToolResult } from "@/lib/mcp-tool-types";
import { assertBoundedHandoffDependencies } from "./bounded-handoff-dependencies";
import { assertHandoffSnapshot, assertRequestedSource, databaseWallTime, readHandoffAuthority, snapshotHandoff, type HandoffRoom, type HandoffSnapshot } from "./bounded-handoff-authority";
import { BoundedHandoffRefusal, handoffDigest, parseBoundedHandoffCommand, type BoundedHandoffCommand, type BoundedHandoffRequest } from "./bounded-handoff-command";
import { hasBoundCommandTransaction } from "./receipted-tool";
import { reassignWorkCapsuleExecutor } from "./workroom-lease";
import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";
import type { WorkCapsuleExecutorKind } from "@/lib/work-capsules";

type StoredRequest = { version: 1; command: BoundedHandoffRequest; ownerUserId: string; ownerPrincipalId: string; sourceAgentId: string; sourceAgentPrincipalId: string; targetAgentPrincipalId: string; snapshot: HandoffSnapshot };
type Input = { db: CapsuleDb; actor: WorkCapsuleActor; command: BoundedHandoffCommand };
const fail = (code: string, message: string): never => { throw new BoundedHandoffRefusal(code, message); };
const readObject = (value: unknown) => isRecord(value) ? value : null;
/** Generic agent activities can carry arbitrary JSON. Only the existing governed receipt proves execution. */
async function acceptedHandoff(db: CapsuleDb, capsule: HandoffRoom, actor: Pick<WorkCapsuleActor, "userId" | "agentId">, command: BoundedHandoffCommand) {
  const row = await db.workroomActivity.findFirst?.({ where: { workCapsuleId: capsule.id, kind: "command-accepted", commandScopeKey: commandAuthorityScopeKey(actor), commandKey: command.commandId } });
  const payload = readObject(row?.payload); const binding = readObject(payload?.payloadBinding); const target = readObject(payload?.target);
  const result = readObject(payload?.result); const data = readObject(result?.data); const handoff = readObject(data?.handoff);
  if (payload?.commandType !== "reassign-executor" || target?.kind !== "workroom" || target.id !== capsule.capsuleId || binding?.version !== 1 || binding.digest !== commandPayloadBinding(command).digest || result?.success !== true || !handoff) return null;
  return handoff;
}
async function readRequest(db: CapsuleDb, capsule: HandoffRoom, requestId: string): Promise<StoredRequest> {
  if (!db.workroomActivity.findFirst) return fail("handoff-history-unavailable", "The stored handoff request could not be verified.");
  const activity = await db.workroomActivity.findFirst({ where: { id: requestId, workCapsuleId: capsule.id, kind: "action" } });
  const payload = readObject(activity?.payload);
  const request = readObject(payload?.request);
  if (payload?.kind !== "bounded-handoff" || payload.state !== "pending-acknowledgement" || request?.version !== 1 || typeof payload.requestDigest !== "string" || handoffDigest(request) !== payload.requestDigest) return fail("handoff-request-invalid", "The stored handoff request is missing or its immutable binding cannot be verified.");
  const parsed = parseBoundedHandoffCommand(readObject(request.command) ?? {});
  const snapshot = readObject(request.snapshot);
  if (parsed?.phase !== "request" || parsed.capsuleId !== capsule.capsuleId || !snapshot || typeof snapshot.digest !== "string" || ![request.ownerUserId, request.ownerPrincipalId, request.sourceAgentId, request.sourceAgentPrincipalId, request.targetAgentPrincipalId].every((value) => typeof value === "string" && value.length > 0)) return fail("handoff-request-invalid", "The stored handoff authority binding is incomplete.");
  const receipt = await acceptedHandoff(db, capsule, { userId: String(request.ownerUserId), agentId: String(request.sourceAgentId) }, parsed);
  if (activity.recordedById !== request.ownerUserId || activity.recordedByAgentId !== request.sourceAgentId || receipt?.requestId !== requestId || receipt.requestDigest !== payload.requestDigest || handoffDigest(receipt.request) !== payload.requestDigest) return fail("handoff-request-unproven", "This activity has no matching accepted handoff command. Ask the source assistant to request the handoff normally.");
  return request as unknown as StoredRequest;
}

/** The same genuine request/ACK receipt predicate serves execution and history. */
async function readCompletionReceipt(db: CapsuleDb, capsule: HandoffRoom, requestId: string, request: StoredRequest) {
  const terminal = db.workroomActivity.findFirst ? await db.workroomActivity.findFirst({
    where: { workCapsuleId: capsule.id, kind: "action", AND: [{ payload: { path: ["kind"], equals: "bounded-handoff" } }, { payload: { path: ["requestId"], equals: requestId } }, { payload: { path: ["state"], equals: "completed" } }] },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
  }) : null;
  if (!terminal) return null;
  const outcome = readObject(terminal.payload);
  const command = typeof outcome?.commandId === "string" ? { phase: "acknowledge" as const, capsuleId: capsule.capsuleId, commandId: outcome.commandId, requestId } : null;
  const receipt = command ? await acceptedHandoff(db, capsule, { userId: request.ownerUserId, agentId: request.command.targetAgentId }, command) : null;
  if (!receipt || receipt.state !== "completed" || receipt.requestId !== requestId || receipt.requestDigest !== handoffDigest(request) || handoffDigest(receipt) !== handoffDigest(outcome)) return fail("handoff-completion-unproven", "This activity has no matching completed handoff receipt. The executor was not transferred by this acknowledgement.");
  const fields = { fromExecutorKind: request.command.expectedExecutorKind, fromExecutorRef: request.command.expectedExecutorRef,
    toExecutorKind: request.command.toExecutorKind, toExecutorRef: request.command.toExecutorRef,
    ownerPrincipalId: request.snapshot.leaseHolderPrincipalId, receivingAgentId: request.command.targetAgentId };
  if (Object.entries(fields).some(([key, value]) => receipt[key] !== value)) return fail("handoff-completion-unproven", "The completed receipt does not match its original request and receiving assistant.");
  const handoff = { ...receipt, ...fields, state: "completed" as const, requestId, requestDigest: handoffDigest(request) };
  return { handoff, activityId: typeof terminal.id === "string" ? terminal.id : null,
    recordedAt: terminal.recordedAt instanceof Date ? terminal.recordedAt.toISOString() : typeof terminal.recordedAt === "string" ? terminal.recordedAt : null };
}

type RecoveryLocator = { approvalId: string; executionId: string };
type RecoveryRequest = { activityId: string; request: StoredRequest; completion: Awaited<ReturnType<typeof readCompletionReceipt>> };
const RECOVERY_REQUEST_LIMIT = 20;

/** One finite, genuine receipt set serves both observation and locked execution. */
async function readRecoveryRequests(db: CapsuleDb, capsule: HandoffRoom, locator: RecoveryLocator, after?: Date): Promise<RecoveryRequest[]> {
  const history = db.workroomActivity as CapsuleDb["workroomActivity"] & { findMany?(args: unknown): Promise<Array<{ id: string }>> };
  if (!history.findMany) return fail("handoff-history-unavailable", "The complete bounded recovery history could not be read.");
  const activities = await history.findMany({ where: { workCapsuleId: capsule.id, kind: "action", ...(after ? { recordedAt: { gte: after } } : {}), AND: [
    { payload: { path: ["kind"], equals: "bounded-handoff" } },
    { payload: { path: ["state"], equals: "pending-acknowledgement" } },
    { payload: { path: ["request", "command", "handoffManifest", "priorFailure", "approvalId"], equals: locator.approvalId } },
    { payload: { path: ["request", "command", "handoffManifest", "priorFailure", "executionId"], equals: locator.executionId } },
  ] }, orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: RECOVERY_REQUEST_LIMIT + 1 });
  if (activities.length > RECOVERY_REQUEST_LIMIT) return fail("handoff-history-over-budget", "The recovery history exceeds its bounded verification limit.");
  const records: RecoveryRequest[] = [];
  for (const activity of activities) {
    const request = await readRequest(db, capsule, activity.id);
    const prior = readObject(request.command.handoffManifest.priorFailure);
    if (prior?.approvalId !== locator.approvalId || prior.executionId !== locator.executionId || prior.reason !== "handoff-transaction-required" || prior.preserve !== true)
      return fail("handoff-failure-lineage-unproven", "The stored request does not prove this original recovery identity.");
    records.push({ activityId: activity.id, request, completion: await readCompletionReceipt(db, capsule, activity.id, request) });
  }
  return records;
}

/** Completion first, then any current viable snapshot, then latest stale history. */
function selectRecoveryRequest(records: readonly RecoveryRequest[], snapshot?: HandoffSnapshot) {
  return records.find(record => record.completion)
    ?? (snapshot ? records.find(record => record.request.snapshot.digest === snapshot.digest) : undefined)
    ?? records[0] ?? null;
}

/** Read-only consequence preview and locked execution use the same positive predicate. */
export async function assessBoundedHandoff(input: Input, options: { lock?: boolean } = {}) {
  const { db, actor, command } = input;
  const capsule = await db.workroom.findUnique({ where: { capsuleId: command.capsuleId } }) as HandoffRoom | null;
  if (!capsule) return fail("handoff-room-not-found", "The Workroom could not be found.");
  const request = command.phase === "acknowledge" ? await readRequest(db, capsule, command.requestId) : null;
  if (request && (actor.userId !== request.ownerUserId || actor.principalId !== request.ownerPrincipalId || actor.agentId !== request.command.targetAgentId || actor.agentPrincipalId !== request.targetAgentPrincipalId)) return fail("handoff-receiver-mismatch", "Only the exact receiving assistant acting for the same human owner can acknowledge this request.");
  const proposed = request?.command ?? command as BoundedHandoffRequest;
  const authority = await readHandoffAuthority({ db, room: capsule, actor,
    ownerUserId: request?.ownerUserId ?? actor.userId, sourceAgentId: request?.sourceAgentId ?? actor.agentId ?? "",
    targetAgentId: proposed.targetAgentId, sourceKind: proposed.expectedExecutorKind, targetKind: proposed.toExecutorKind, lock: options.lock === true });
  if (request && (request.sourceAgentPrincipalId !== authority.sourcePrincipalId || request.targetAgentPrincipalId !== authority.targetPrincipalId)) return fail("handoff-identity-changed", "The handoff's canonical assistant identity changed.");
  const completion = request && command.phase === "acknowledge" ? await readCompletionReceipt(db, capsule, command.requestId, request) : null;
  if (completion && request) return { capsule, request, proposed, authority, snapshot: request.snapshot, terminal: completion.handoff };
  await assertBoundedHandoffDependencies(db as unknown as Parameters<typeof assertBoundedHandoffDependencies>[0], { capsule, sourceExecutorRef: proposed.expectedExecutorRef, destinationExecutorRef: proposed.toExecutorRef });
  const now = await databaseWallTime(db);
  const snapshot = snapshotHandoff(capsule, authority.boundary, now);
  if (request) assertHandoffSnapshot(snapshot, request.snapshot);
  else assertRequestedSource(capsule, proposed, actor.principalId);
  return { capsule, request, proposed, authority, snapshot, terminal: null };
}
/** Runs only inside the real receipt transaction after the shared lock prefix. */
export async function executeBoundedHandoff(input: Input): Promise<ToolResult> {
  if (!hasBoundCommandTransaction(input.db) || typeof input.db.$queryRaw !== "function") return fail("handoff-transaction-required", "Use the governed handoff command with its command identity and transaction.");
  const { capsule, request, proposed, authority, snapshot, terminal } = await assessBoundedHandoff(input, { lock: true });
  const { db, actor, command } = input;
  if (terminal) return { success: true, entityId: capsule.capsuleId, message: "This receiving assistant already acknowledged the completed handoff.", data: { handoff: terminal, assistantAdmitted: false } };
  if (command.phase === "request") {
    // The governed receipt transaction already holds the room's authority lock.
    // A preview is revocable: another ready packet may have been executed since it was read.
    const prior = readObject(command.handoffManifest.priorFailure);
    if (prior?.reason === "handoff-transaction-required" && prior.preserve === true) {
      if (typeof prior.approvalId !== "string" || typeof prior.executionId !== "string" || !db.workroomActivity.findFirst)
        return fail("handoff-history-unavailable", "The original recovery identity could not be checked.");
      const records = await readRecoveryRequests(db, capsule, { approvalId: prior.approvalId, executionId: prior.executionId });
      const selected = selectRecoveryRequest(records, snapshot);
      if (selected?.completion)
        return fail("handoff-recovery-already-completed", "This original failure already has a completed handoff. Read its recorded outcome.");
      if (selected) {
        try { assertHandoffSnapshot(snapshot, selected.request.snapshot); }
        catch (error) {
          if (!(error instanceof BoundedHandoffRefusal) || !["handoff-lease-snapshot-changed", "handoff-boundary-changed"].includes(error.code)) throw error;
          // The complete bounded set has no viable request. Its stale receipts
          // remain immutable history; the fresh request captures current authority.
        }
        if (snapshot.digest === selected.request.snapshot.digest)
          return fail("handoff-recovery-already-requested", "This original failure already has a current handoff request. Read that request and its actual receiver outcome.");
      }
    }
    const requestId = "handoff-" + randomUUID();
    const stored: StoredRequest = { version: 1, command, ownerUserId: actor.userId, ownerPrincipalId: actor.principalId!, sourceAgentId: actor.agentId!, sourceAgentPrincipalId: authority.sourcePrincipalId, targetAgentPrincipalId: authority.targetPrincipalId, snapshot };
    const handoff = { kind: "bounded-handoff", state: "pending-acknowledgement", requestId, requestDigest: handoffDigest(stored), request: stored,
      identityAssurance: "The receiving assistant endorses the destination; no external chat is authenticated." };
    await db.workroomActivity.create({ data: { id: requestId, workCapsuleId: capsule.id, kind: "action", summary: "Handoff requested; waiting for the receiving assistant", payload: handoff, recordedById: actor.userId, recordedByAgentId: actor.agentId } });
    return { success: true, entityId: capsule.capsuleId, message: "Handoff requested; waiting for the receiving assistant. The executor and lease have not changed.", data: { handoff, assistantAdmitted: false } };
  }
  if (!request) return fail("handoff-request-invalid", "The stored handoff request could not be resolved.");
  const now = await databaseWallTime(db);
  // A long dependency/identity read cannot outlive the lease it validated.
  snapshotHandoff(capsule, authority.boundary, now);
  const updated = await reassignWorkCapsuleExecutor({ db, capsuleId: capsule.capsuleId,
    toExecutorKind: proposed.toExecutorKind as WorkCapsuleExecutorKind, toExecutorRef: proposed.toExecutorRef,
    actor, expectedLeaseHolderPrincipalId: snapshot.leaseHolderPrincipalId, reason: proposed.reason,
    handoffManifest: { ...proposed.handoffManifest, boundedHandoff: { requestId: command.requestId, requestDigest: handoffDigest(request), receivingAgentId: actor.agentId, receivingAgentPrincipalId: actor.agentPrincipalId } }, now, deferPublication: true });
  const handoff = { kind: "bounded-handoff", state: "completed", commandId: command.commandId, requestId: command.requestId, requestDigest: handoffDigest(request),
    fromExecutorKind: proposed.expectedExecutorKind, fromExecutorRef: proposed.expectedExecutorRef, toExecutorKind: proposed.toExecutorKind, toExecutorRef: proposed.toExecutorRef,
    ownerPrincipalId: snapshot.leaseHolderPrincipalId, receivingAgentId: actor.agentId, receivingAgentPrincipalId: actor.agentPrincipalId,
    identityAssurance: "The receiving assistant endorses the destination; no external chat is authenticated." };
  await db.workroomActivity.create({ data: { workCapsuleId: capsule.id, kind: "action", summary: "Receiving assistant acknowledged; handoff completed", payload: handoff, recordedById: actor.userId, recordedByAgentId: actor.agentId } });
  return { success: true, entityId: capsule.capsuleId, message: "Receiving assistant acknowledged; handoff completed.", data: { capsule: updated, handoff, assistantAdmitted: false } };
}
export function boundedHandoffRefusalResult(error: unknown, command?: BoundedHandoffCommand | null): ToolResult {
  const code = error instanceof BoundedHandoffRefusal ? error.code : typeof (error as { code?: unknown })?.code === "string" ? String((error as { code: string }).code) : "handoff-verification-unavailable";
  const message = error instanceof Error ? error.message : "The handoff boundary could not be verified.";
  return { success: false, error: code, message, data: { handoff: { kind: "bounded-handoff", state: "refused", requestId: command?.phase === "acknowledge" ? command.requestId : null, reason: message, code } } };
}

export type FailedHandoffOperation = { approvalId: string; executionId: string; executedAtIso: string; ownerUserId: string; sourceAgentId: string | null; command: BoundedHandoffRequest };

/** Read-only, receipt-backed lineage. Arbitrary activity JSON is never proof. */
export async function readBoundedHandoffLineage(db: CapsuleDb, capsule: HandoffRoom, failure: FailedHandoffOperation, options: { actor?: WorkCapsuleActor } = {}) {
  const records = await readRecoveryRequests(db, capsule, failure, new Date(failure.executedAtIso));
  if (!records.length) {
    // An unreadable/dangling row is not authoritative empty history. Preserve the
    // existing conservative check before permitting fresh recovery eligibility.
    if (!db.workroomActivity.findFirst) return fail("handoff-history-unavailable", "The original handoff lineage could not be verified.");
    const unexpected = await db.workroomActivity.findFirst({ where: { workCapsuleId: capsule.id, kind: "action", recordedAt: { gte: new Date(failure.executedAtIso) },
      AND: [{ payload: { path: ["kind"], equals: "bounded-handoff" } }, { payload: { path: ["state"], equals: "pending-acknowledgement" } }] },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }] });
    if (unexpected) { await readRequest(db, capsule, unexpected.id); return fail("handoff-failure-lineage-unproven", "This history does not prove the original failed operation."); }
    return null;
  }
  const original = failure.command;
  for (const { request } of records) {
    const proposed = request.command;
    if (request.ownerUserId !== failure.ownerUserId || request.sourceAgentId !== failure.sourceAgentId
      || proposed.expectedExecutorKind !== original.expectedExecutorKind || proposed.expectedExecutorRef !== original.expectedExecutorRef
      || proposed.targetAgentId !== original.targetAgentId || proposed.toExecutorKind !== original.toExecutorKind || proposed.toExecutorRef !== original.toExecutorRef)
      return fail("handoff-failure-lineage-unproven", "The handoff does not prove a continuation of this original failed operation.");
  }
  let selected = selectRecoveryRequest(records)!;
  if (selected.completion) return { ...selected.completion.handoff, activityId: selected.completion.activityId, recordedAt: selected.completion.recordedAt };
  if (options.actor) {
    if (options.actor.userId !== failure.ownerUserId || options.actor.agentId !== failure.sourceAgentId)
      return fail("handoff-authenticated-assistant-required", "Only the original source assistant can assess a fresh handoff for this owner.");
    let current: Awaited<ReturnType<typeof assessBoundedHandoff>>;
    try { current = await assessBoundedHandoff({ db, actor: options.actor, command: original }); }
    catch (error) {
      if (error instanceof BoundedHandoffRefusal && ["handoff-lease-expired", "handoff-source-changed"].includes(error.code))
        return { state: "stale" as const, reason: error.code, requestId: selected.activityId };
      throw error;
    }
    selected = selectRecoveryRequest(records, current.snapshot)!;
    try { assertHandoffSnapshot(current.snapshot, selected.request.snapshot); }
    catch (error) {
      if (error instanceof BoundedHandoffRefusal && ["handoff-boundary-changed", "handoff-lease-snapshot-changed"].includes(error.code))
        return { state: "stale" as const, reason: error.code, requestId: selected.activityId };
      throw error;
    }
  }
  const { request, activityId } = selected;
  const stale = capsule.executorKind !== request.snapshot.executorKind || capsule.executorRef !== request.snapshot.executorRef
    ? "handoff-source-changed"
    : capsule.leaseHolderPrincipalId !== request.snapshot.leaseHolderPrincipalId || capsule.leaseExpiresAt?.toISOString() !== request.snapshot.leaseExpiresAt
      ? "handoff-lease-snapshot-changed"
      : !capsule.leaseExpiresAt || capsule.leaseExpiresAt.getTime() <= (await databaseWallTime(db)).getTime() ? "handoff-lease-expired" : null;
  if (stale) return { state: "stale" as const, reason: stale, requestId: activityId };
  return { state: "pending" as const, requestId: activityId, requestDigest: handoffDigest(request),
    receiverRef: request.command.toExecutorRef, receivingAgentId: request.command.targetAgentId };
}
