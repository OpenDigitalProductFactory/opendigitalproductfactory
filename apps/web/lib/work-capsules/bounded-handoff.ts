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
  const terminal = request && db.workroomActivity.findFirst ? await db.workroomActivity.findFirst({
    where: { workCapsuleId: capsule.id, kind: "action", AND: [{ payload: { path: ["kind"], equals: "bounded-handoff" } }, { payload: { path: ["requestId"], equals: command.phase === "acknowledge" ? command.requestId : "" } }, { payload: { path: ["state"], equals: "completed" } }] },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
  }) : null;
  if (terminal && request && command.phase === "acknowledge") {
    const outcome = readObject(terminal.payload);
    const terminalCommand = typeof outcome?.commandId === "string" ? { phase: "acknowledge" as const, capsuleId: capsule.capsuleId, commandId: outcome.commandId, requestId: command.requestId } : null;
    const receipt = terminalCommand ? await acceptedHandoff(db, capsule, { userId: request.ownerUserId, agentId: request.command.targetAgentId }, terminalCommand) : null;
    if (!receipt || receipt.state !== "completed" || receipt.requestId !== command.requestId || receipt.requestDigest !== handoffDigest(request) || handoffDigest(receipt) !== handoffDigest(outcome)) return fail("handoff-completion-unproven", "This activity has no matching completed handoff receipt. The executor was not transferred by this acknowledgement.");
    return { capsule, request, proposed, authority, snapshot: request.snapshot, terminal: receipt };
  }
  await assertBoundedHandoffDependencies(db as unknown as Parameters<typeof assertBoundedHandoffDependencies>[0], { capsule, sourceExecutorRef: proposed.expectedExecutorRef, destinationExecutorRef: proposed.toExecutorRef });
  const now = await databaseWallTime(db);
  const snapshot = snapshotHandoff(capsule, authority.boundary, now);
  if (request) assertHandoffSnapshot(snapshot, request.snapshot);
  else assertRequestedSource(capsule, proposed, actor.principalId);
  return { capsule, request, proposed, authority, snapshot, terminal: null };
}
/** Runs only inside the real receipt transaction after the shared lock prefix. */
export async function executeBoundedHandoff(input: Input): Promise<ToolResult> {
  if (!hasBoundCommandTransaction() || !input.db.$queryRaw || input.db.$transaction) return fail("handoff-transaction-required", "Use the governed handoff command with its command identity and transaction.");
  const { capsule, request, proposed, authority, snapshot, terminal } = await assessBoundedHandoff(input, { lock: true });
  const { db, actor, command } = input;
  if (terminal) return { success: true, entityId: capsule.capsuleId, message: "This receiving assistant already acknowledged the completed handoff.", data: { handoff: terminal, assistantAdmitted: false } };
  if (command.phase === "request") {
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
