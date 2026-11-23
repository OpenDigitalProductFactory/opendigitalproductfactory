import { prisma, type Prisma } from "@dpf/db";
import { parseAbsoluteResetAt } from "@/lib/routing/cli-limit-reset";
import { runtimeAccountDriver, RUNTIME_ACCOUNT_DRIVERS } from "@/lib/workroom-runtime/runtime-account";
import { readStoredRuntimeSession } from "@/lib/workroom-runtime/supervised-session";
import type { ClaimedEffect } from "@/lib/workroom-runtime/workroom-effect-store";
import { resolveAgentWorkroomAccess } from "@/lib/work-management/workroom-agent-access.server";
import { TERMINAL_WORKROOM_STATUSES } from "@/lib/work-management/standing-room-nesting";
import { externalAgentForSurface, type HandoffRoom } from "./bounded-handoff-authority";
import { BoundedHandoffRefusal, parseBoundedHandoffCommand, type BoundedHandoffRequest } from "./bounded-handoff-command";
import { capacityAlternatives, checkpointOf, executorResumedAfter, EXECUTOR_PLAN_PROVIDER, formatCentral,
  latestExecutorActivity, loadProviderCapacityRows, parseCheckpointCapacity, providerRecoveredAfter, runtimePlanLimit } from "./executor-capacity";
import { recordExecutorCapacityNote } from "./workroom-lease";
import type { CapsuleDb } from "./work-capsule-store-types";

type CapacityRoom = Pick<HandoffRoom, "executorKind" | "leaseExpiresAt"> & {
  workspaceState: unknown; lastSyncedAt: Date | null;
};
type Observation = { provider: string; observedAt: string; resetAt: string | null; generation: string | null };
type CapacityDb = Pick<Prisma.TransactionClient, "aiProviderConnection" | "providerCapacityStatus">;
const capacitySelect = { providerId: true, state: true, retryAt: true, lastObservedAt: true, lastSuccessAt: true } as const;

async function offerAlternatives(db: CapacityDb, room: CapacityRoom, ownerPrincipalId: string, now: Date, providerRows: Awaited<ReturnType<typeof loadProviderCapacityRows>>) {
  if (!room.executorKind) return [];
  // Connections are organization-scoped. Only a recorded accountable owner
  // proves the same-owner binding for an automatic offer.
  const accounts = await db.aiProviderConnection.findMany({
    where: { organization: { topAccountablePrincipalId: ownerPrincipalId }, providerId: { in: [...RUNTIME_ACCOUNT_DRIVERS.keys()] },
      status: { in: ["active", "degraded"] }, credentialEntry: { status: "ok" } },
    orderBy: { connectionId: "asc" },
    select: { providerId: true, connectionId: true, executionChannel: true, authMethod: true,
      capacityStatus: { select: capacitySelect }, quotaStatus: { select: capacitySelect }, ownedHealth: { select: capacitySelect } },
  });
  const connections = accounts.flatMap(account => {
    const provider = runtimeAccountDriver(account);
    return provider ? [{ executorKind: `${provider}-desktop`, connectionId: account.connectionId,
      capacity: [account.capacityStatus, account.quotaStatus, account.ownedHealth] }] : [];
  });
  return capacityAlternatives({ executorKind: room.executorKind, now, providerRows, connections });
}

function observationCurrent(room: CapacityRoom, observation: Observation): boolean {
  const { generation, observedAt, provider } = observation;
  const session = readStoredRuntimeSession(room.workspaceState);
  const checkpoint = checkpointOf(room.workspaceState);
  return !!room.executorKind && EXECUTOR_PLAN_PROVIDER[room.executorKind] === provider
    && (generation ? session?.generation === generation : (checkpoint?.capacity?.recordedAt ?? checkpoint?.recordedAt) === observedAt)
    && !executorResumedAfter(room.leaseExpiresAt, latestExecutorActivity(room.workspaceState, room.lastSyncedAt), Date.parse(observedAt));
}

async function providerRecovered(db: CapacityDb, room: CapacityRoom, observation: Observation, rows: Awaited<ReturnType<typeof loadProviderCapacityRows>>) {
  const source = observation.generation ? readStoredRuntimeSession(room.workspaceState) : null;
  const account = source?.connectionId ? await db.aiProviderConnection.findUnique({
    where: { connectionId: source.connectionId },
    select: { quotaStatus: { select: capacitySelect } },
  }) : null;
  return providerRecoveredAfter(account?.quotaStatus ?? rows.find(row => row.providerId === observation.provider), Date.parse(observation.observedAt));
}

/** The existing locked request/acknowledge path re-proves the automatic offer. */
export async function assertPlanLimitHandoffCurrent(db: CapacityDb, room: HandoffRoom, command: BoundedHandoffRequest, ownerPrincipalId: string, now: Date) {
  const observed = command.handoffManifest.planLimit as Observation | undefined;
  if (!observed) return;
  if (!Number.isFinite(Date.parse(observed.observedAt))) {
    throw new BoundedHandoffRefusal("handoff-plan-limit-cleared", "The timestamp of the plan limit could not be verified.");
  }
  const capacityRoom = room as HandoffRoom & CapacityRoom;
  const rows = await loadProviderCapacityRows(db);
  if (room.archivedAt || TERMINAL_WORKROOM_STATUSES.has(String(room.status)) || !observationCurrent(capacityRoom, observed)
    || observed.resetAt && Date.parse(observed.resetAt) <= now.getTime()
    || await providerRecovered(db, capacityRoom, observed, rows)) {
    throw new BoundedHandoffRefusal("handoff-plan-limit-cleared", "The source executor has resumed or its capacity wait has expired.");
  }
  const alternatives = await offerAlternatives(db, capacityRoom, ownerPrincipalId, now, rows);
  if (!alternatives.some(alternative => alternative.executorKind === command.toExecutorKind
    && (alternative.connectionId ?? alternative.executorKind) === command.toExecutorRef)) {
    throw new BoundedHandoffRefusal("handoff-plan-limit-destination-unavailable", "The proposed executor is no longer an available same-owner alternative.");
  }
}

/** Run for both reported heartbeat limits and failed-turn effects. The
 * existing command receipt makes an effect retry replay the same request. */
export async function recordPlanLimitHandoff(effect: ClaimedEffect, now: Date): Promise<Record<string, unknown>> {
  const { capsuleId, payload } = effect;
  const room = await prisma.workroom.findUnique({ where: { capsuleId } });
  if (!room || room.archivedAt || TERMINAL_WORKROOM_STATUSES.has(room.status)) return {};
  const session = readStoredRuntimeSession(room.workspaceState);
  const heartbeat = payload.checkpoint !== undefined;
  const observedAt = typeof payload.observedAt === "string" ? payload.observedAt : session?.lastHeartbeatAt;
  if (!observedAt || !Number.isFinite(Date.parse(observedAt))) return {};
  const reported = heartbeat ? parseCheckpointCapacity(payload.checkpoint) : null;
  const limit = heartbeat
    ? reported?.ok ? { provider: reported.data.provider, resetAt: new Date(reported.data.resetAt) } : null
    : runtimePlanLimit(String(payload.provider), typeof payload.error === "string" ? payload.error : null, new Date(observedAt), parseAbsoluteResetAt);
  if (!limit) return {};
  const rows = await loadProviderCapacityRows(prisma);
  const providerRow = rows.find(row => row.providerId === limit.provider);
  const resetAt = limit.resetAt?.toISOString() ?? (providerRow?.retryAt && providerRow.retryAt > now
    && ["quota_resets_at", "rate_limited"].includes(providerRow.state) ? providerRow.retryAt.toISOString() : null);
  const observation: Observation = { provider: limit.provider, observedAt, resetAt,
    generation: heartbeat ? null : typeof payload.generation === "string" ? payload.generation : session?.generation ?? null };
  if (!observationCurrent(room, observation) || await providerRecovered(prisma, room, observation, rows)) return {};
  if (!heartbeat && resetAt) {
    const updated = await recordExecutorCapacityNote({ db: prisma as unknown as CapsuleDb, capsuleId,
      capacity: { provider: limit.provider, resetAt }, now: new Date(observedAt),
      ifCurrent: current => observationCurrent(current, observation) });
    if (!updated) return {};
  }
  const summary = resetAt
    ? `Plan limit reached on ${limit.provider}; expected back by ${formatCentral(new Date(resetAt))} (may return sooner).`
    : `Plan limit reached on ${limit.provider}; the provider gave no reset time.`;
  const result = { provider: limit.provider, resetAt, summary };
  const userId = heartbeat ? payload.userId : session?.actor?.userId;
  const ownerPrincipalId = heartbeat ? payload.principalId : session?.actor?.principalId;
  if (typeof userId !== "string" || typeof ownerPrincipalId !== "string" || !room.leaseHolderPrincipalId
    || !room.executorKind || !room.executorRef || resetAt && Date.parse(resetAt) <= now.getTime()) return result;
  const agentId = externalAgentForSurface(room.executorKind);
  if (!agentId || heartbeat && payload.agentId !== agentId) return result;
  const { decision, authorityContext } = await resolveAgentWorkroomAccess({ userId, agentId, workroomId: room.id, requested: "action" });
  const agentPrincipalId = authorityContext?.agentPrincipal?.id;
  if (decision.level !== "action" || !agentPrincipalId || authorityContext?.humanPrincipal?.id !== ownerPrincipalId) return result;
  const alternatives = await offerAlternatives(prisma, room, ownerPrincipalId, now, rows);
  const checkpoint = (room.workspaceState as { executorCheckpoint?: { nextAction?: string; openRisks?: string[] } } | null)?.executorCheckpoint;
  const [{ receiptedWorkroomTool, commandDb }, { prepareBoundedHandoff }, { assessBoundedHandoff, executeBoundedHandoff, boundedHandoffRefusalResult }] = await Promise.all([
    import("./receipted-tool"), import("./bounded-handoff-tool"), import("./bounded-handoff"),
  ]);
  const actor = { userId, agentId, principalId: ownerPrincipalId, agentPrincipalId };
  const request = receiptedWorkroomTool("reassign-executor", async params => {
    const command = parseBoundedHandoffCommand(params)!;
    try {
      return await executeBoundedHandoff({ db: commandDb(), command, actor });
    } catch (error) {
      if (!(error instanceof BoundedHandoffRefusal)) throw error;
      return boundedHandoffRefusalResult(error, command);
    }
  }, { prepare: prepareBoundedHandoff });
  for (const alternative of alternatives) {
    const toExecutorRef = alternative.connectionId ?? alternative.executorKind;
    const command = parseBoundedHandoffCommand({
      phase: "request", commandId: `plan-limit:${effect.id}`, capsuleId, expectedLeaseHolderPrincipalId: room.leaseHolderPrincipalId,
      expectedExecutorKind: room.executorKind, expectedExecutorRef: room.executorRef,
      toExecutorKind: alternative.executorKind, toExecutorRef, targetAgentId: externalAgentForSurface(alternative.executorKind),
      handoffManifest: { nextAction: checkpoint?.nextAction || room.objective.slice(0, 4000) || "Continue the room's current work.", openRisks: checkpoint?.openRisks ?? [],
        planLimit: observation, ...(alternative.connectionId ? { connectionId: alternative.connectionId } : {}) },
      reason: "The current executor reached its plan limit.",
    })!;
    try {
      await assessBoundedHandoff({ db: prisma as unknown as CapsuleDb, command, actor });
    } catch (error) {
      if (error instanceof BoundedHandoffRefusal && ["handoff-room-admission-required", "handoff-plan-limit-destination-unavailable"].includes(error.code)) continue;
      if (error instanceof BoundedHandoffRefusal) break;
      throw error;
    }
    const offered = await request({ ...command }, userId, { agentId });
    if (offered.success) return { ...result, handoff: (offered.data as { handoff?: unknown })?.handoff ?? null };
    break;
  }
  return result;
}
