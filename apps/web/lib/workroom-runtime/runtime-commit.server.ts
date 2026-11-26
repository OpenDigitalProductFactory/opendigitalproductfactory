// BI-C64EDA33 (plan 2026-11-14-workroom-runtime-core): commit one runtime
// command. Inside the room's receipted-command transaction (room row locked,
// receipt in the room's own log) it reads the runtime record, decides, and
// writes the log rows, the record, the outbox effects, any retirements and any
// effect settlement together. Either all of it commits or none of it does; a
// retry of the same command id replays the stored reply and inserts nothing.
//
// An acknowledgement means only that the intent committed: the effects run
// afterwards on the effect worker, which reports each result as a command.

import { prisma } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { executionHostRef } from "@/lib/agent-toolchain/execution-host-registry";
import { revalidatePortalContext } from "@/lib/portal-context/invalidation";
import { publishRecordedWorkCapsuleActivity } from "@/lib/work-capsules/activity-events";
import { commandPayloadBinding, runReceiptedCommand, type ReceiptDb } from "@/lib/work-capsules/command-receipts";
import { recordWorkCapsuleActivity } from "@/lib/work-capsules/work-capsule-activity-store";
import type { CapsuleDb, WorkCapsuleActor } from "@/lib/work-capsules/work-capsule-store-types";
import { isTerminalCapsuleStatus } from "@/lib/work-capsules/work-capsule-branch-identity";

import { decideRuntimeCommand, type ActivityIntent, type RuntimeCommand } from "./runtime-decider";
import { decideProtectedExecutionBinding, findProtectedExecutionBinding, protectedBindingIdentity,
  readProtectedExecutionBindings, readProtectedExecutionTarget,
  type ProtectedBindingInput, type ProtectedExecutionBinding, type ProtectedExecutionTarget } from "./protected-execution-binding";
import { readStoredRuntimeSession, type StoredRuntimeSession } from "./supervised-session";
import { insertEffects, PROTECTED_LAUNCH_EFFECT_KIND, retireEffects, settleEffect } from "./workroom-effect-store";

export type RuntimeCommitInput = { capsuleId: string; commandId: string; command: RuntimeCommand; actor: WorkCapsuleActor };

/** The stored reply, or null when the room does not exist. */
export type RuntimeCommitter = (input: RuntimeCommitInput) => Promise<Record<string, unknown> | null>;

type ProtectedLaunchInput = { target: ProtectedExecutionTarget; commandId: string; actor: WorkCapsuleActor };
type ProtectedLaunchAuthority = Omit<ProtectedBindingInput, "workspaceState" | "now">;

type LaunchReservationInput = {
  binding: ProtectedExecutionBinding;
  projectionDigest: string;
  effectId: string;
  attempt: number;
  leaseOwner: string;
  signal: AbortSignal;
};

/** Before touching the receiver socket, make the start a single-use action protected by the current lease and the room lock. */
export function createProtectedLaunchReservation(deps: {
  db?: unknown;
  // Server-owned local reads only. Revalidation includes S5, membership, the current qualification and exact projection digest.
  isCurrentAuthority: (tx: ReceiptDb, input: LaunchReservationInput) => Promise<boolean>;
}) {
  const db = (deps.db ?? prisma) as ReceiptDb;
  return async (input: LaunchReservationInput): Promise<"held" | "readback-only" | "reserved"> => {
    const { binding, effectId, leaseOwner, attempt, signal, projectionDigest } = input;
    if (!Number.isSafeInteger(attempt) || attempt < 1 || signal.aborted || !/^[a-f0-9]{64}$/.test(projectionDigest)) return "held";
    let writtenByThisCall = false;
    const result = await runReceiptedCommand({
      db, target: { kind: "workroom", id: binding.roomRef }, authorityScopeKey: `workroom-protected-reservation:${binding.roomRef}`,
      commandId: `${effectId}:${attempt}`, commandType: "workroom-runtime.reserve-protected-launch",
      payloadBinding: commandPayloadBinding({ binding, projectionDigest, effectId, attempt, leaseOwner }),
      run: async (receiptTx) => {
        const tx = receiptTx as unknown as CommitTx;
        const room = await tx.workroom.findUnique({ where: { capsuleId: binding.roomRef },
          select: { id: true, archivedAt: true, status: true, workspaceState: true } });
        if (!room || room.archivedAt || isTerminalCapsuleStatus(room.status)) return "held" as const;
        const record = readProtectedExecutionBindings(room.workspaceState);
        const stored = record && findProtectedExecutionBinding(record, binding);
        if (!record || !stored || canonicalJson(protectedBindingIdentity(stored)) !== canonicalJson(binding)) return "held" as const;
        if (stored.launch.phase === "possibly-started") return "readback-only" as const;
        const leases = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "WorkroomEffect" WHERE "id"=${effectId} AND "workCapsuleId"=${room.id}
            AND "attemptCount"=${attempt} AND "leaseOwner"=${leaseOwner} AND "status"='running'::"WorkroomEffectStatus"
            AND "kind"::text='launch-protected-session' AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
            AND "payload"->>'sessionRef'=${binding.sessionRef} AND "payload"->>'stageAttemptRef'=${binding.stageAttemptRef}
          FOR UPDATE`;
        if (leases.length !== 1 || !await deps.isCurrentAuthority(receiptTx, input) || signal.aborted) return "held" as const;
        const next = { version: 1, bindings: record.bindings.map(entry => entry === stored
          ? { ...entry, launch: { phase: "possibly-started", projectionDigest } } : entry) };
        await tx.$executeRaw`UPDATE "WorkCapsule" SET "workspaceState" = jsonb_set(COALESCE("workspaceState", '{}'::jsonb), '{protectedExecution}', ${JSON.stringify(next)}::jsonb, true) WHERE "id" = ${room.id}`;
        writtenByThisCall = true;
        return "reserved" as const;
      },
    });
    // An existing command receipt proves the boundary was crossed, never grants its caller a second send.
    return result === "reserved" && !writtenByThisCall ? "readback-only" : result;
  };
}

/** Called only by the protected path. `readAuthority` resolves server-owned facts within the room transaction. */
export function createProtectedLaunchCommitter(deps: {
  db?: unknown;
  now?: () => Date;
  readAuthority: (tx: ReceiptDb, input: ProtectedLaunchInput) => Promise<ProtectedLaunchAuthority | null>;
}) {
  const db = (deps.db ?? prisma) as ReceiptDb;
  const clock = deps.now ?? (() => new Date());
  return async (input: ProtectedLaunchInput) => {
    const target = readProtectedExecutionTarget(input.target);
    if (!target || !executionHostRef.safeParse(input.commandId).success || !input.actor.principalId) {
      return { outcome: "held", reason: "invalid-launch-intent" };
    }
    const payloadBinding = commandPayloadBinding({ target, actorPrincipalRef: input.actor.principalId });
    return runReceiptedCommand({
      db, target: { kind: "workroom", id: target.roomRef }, actor: input.actor,
      authorityScopeKey: `workroom-protected-launch:${target.roomRef}`, commandId: input.commandId,
      commandType: "workroom-runtime.launch-protected-session", payloadBinding,
      run: async (receiptTx) => {
        const tx = receiptTx as unknown as CommitTx;
        const room = await tx.workroom.findUnique({ where: { capsuleId: target.roomRef },
          select: { id: true, archivedAt: true, status: true, workspaceState: true } });
        if (!room || room.archivedAt || isTerminalCapsuleStatus(room.status)) return { outcome: "held", reason: "room-unavailable" };
        const authority = await deps.readAuthority(receiptTx, { ...input, target });
        const admittedTarget = readProtectedExecutionTarget(authority?.target);
        if (!authority || !admittedTarget || canonicalJson(admittedTarget) !== canonicalJson(target)) {
          return { outcome: "held", reason: "admission-mismatch" };
        }
        const at = clock();
        const decision = decideProtectedExecutionBinding({ ...authority, target, now: at, workspaceState: room.workspaceState });
        if (!decision.ok) return { outcome: "held", reason: decision.error };
        const { hostRef, sessionRef, stageAttemptRef } = decision.data.binding;
        if (!decision.data.created) return { outcome: "already-bound", hostRef };
        await tx.$executeRaw`UPDATE "WorkCapsule" SET "workspaceState" = jsonb_set(COALESCE("workspaceState", '{}'::jsonb), '{protectedExecution}', ${JSON.stringify(decision.data.record)}::jsonb, true) WHERE "id" = ${room.id}`;
        await insertEffects(tx, { roomRowId: room.id, commandId: `protected-launch:${payloadBinding.digest}`, generation: null, now: at,
          effects: [{ kind: PROTECTED_LAUNCH_EFFECT_KIND, payload: { sessionRef, stageAttemptRef } }] });
        return { outcome: "bound", hostRef };
      },
    });
  };
}

/** A settlement from an attempt whose lease was lost: nothing is written. */
export class StaleEffectSettlementError extends Error {
  constructor(effectId: string) {
    super(`Effect ${effectId} is no longer held by this attempt.`);
    this.name = "StaleEffectSettlementError";
  }
}

class RoomNotFoundError extends Error {}

type CommitTx = CapsuleDb & {
  workItemMessage: { update(args: unknown): Promise<unknown> };
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
};

/** The runtime writes as the person who opened the session, attributed to the runtime agent. */
function actorFor(intent: ActivityIntent, actor: WorkCapsuleActor, session: StoredRuntimeSession | null): WorkCapsuleActor {
  if (intent.as === "actor") return actor;
  const starter = session?.actor;
  return starter ? { userId: starter.userId, agentId: "workroom-runtime", principalId: starter.principalId } : { ...actor, agentId: "workroom-runtime" };
}

export function createRuntimeCommitter(deps: { db?: unknown; now?: () => Date } = {}): RuntimeCommitter {
  const db = (deps.db ?? prisma) as ReceiptDb;
  const clock = deps.now ?? (() => new Date());
  return async (input) => {
    let outcome: { reply: Record<string, unknown>; roomRowId: string; activityIds: string[] };
    try {
      outcome = await runReceiptedCommand({
        db,
        authorityScopeKey: `workroom-runtime:${input.capsuleId}`,
        commandId: input.commandId,
        commandType: `workroom-runtime.${input.command.type}`,
        target: { kind: "workroom", id: input.capsuleId },
        actor: { userId: input.actor.userId, agentId: input.actor.agentId },
        run: async (receiptTx) => {
          const tx = receiptTx as unknown as CommitTx;
          const room = await tx.workroom.findUnique({ where: { capsuleId: input.capsuleId }, select: { id: true, workspaceState: true } });
          if (!room) throw new RoomNotFoundError();
          const before = readStoredRuntimeSession(room.workspaceState);
          const decision = decideRuntimeCommand({ session: before }, input.commandId, input.command);
          const run = tx;
          const at = clock();
          if (decision.settle && !(await settleEffect(run, decision.settle, at))) throw new StaleEffectSettlementError(decision.settle.effectId);
          const activities = [...decision.activities];
          if (decision.retire) {
            const retired = await retireEffects(run, { roomRowId: room.id, keepGeneration: decision.retire.keepGeneration, reason: decision.retire.reason, now: at });
            if (retired.length > 0) {
              activities.push({ kind: "effect-retired", as: "runtime", payload: { effects: retired, reason: decision.retire.reason },
                summary: `Retired ${retired.length} runtime step(s) (${[...new Set(retired.map((r) => r.kind))].join(", ")}): ${decision.retire.reason}. They are not replayed.` });
            }
          }
          const after = decision.session ?? before;
          const activityIds: string[] = [];
          for (const intent of activities) {
            const row = await recordWorkCapsuleActivity(tx, {
              workCapsuleId: room.id, kind: intent.kind, summary: intent.summary, payload: intent.payload, actor: actorFor(intent, input.actor, after),
            }, { deferPublication: true });
            if (row?.id) activityIds.push(row.id);
          }
          if (decision.session !== undefined) {
            await tx.$executeRaw`UPDATE "WorkCapsule" SET "workspaceState" = jsonb_set(COALESCE("workspaceState", '{}'::jsonb), '{runtimeSession}', ${JSON.stringify(decision.session)}::jsonb, true) WHERE "id" = ${room.id}`;
          }
          if (decision.messageWake) {
            // The message reads as delivered only together with the decision that hands it over.
            await tx.workItemMessage.update({ where: { id: decision.messageWake.messageRowId }, data: { structuredPayload: decision.messageWake.structuredPayload } });
          }
          await insertEffects(run, { roomRowId: room.id, commandId: input.commandId, generation: after?.generation ?? null, effects: decision.effects, now: at });
          return { reply: decision.reply, roomRowId: room.id, activityIds };
        },
      });
    } catch (error) {
      if (error instanceof RoomNotFoundError) return null;
      throw error;
    }
    for (const id of outcome.activityIds) publishRecordedWorkCapsuleActivity(outcome.roomRowId, id);
    if (outcome.activityIds.length > 0) revalidatePortalContext();
    return outcome.reply;
  };
}
