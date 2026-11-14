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
import { revalidatePortalContext } from "@/lib/portal-context/invalidation";
import { publishRecordedWorkCapsuleActivity } from "@/lib/work-capsules/activity-events";
import { runReceiptedCommand, type ReceiptDb } from "@/lib/work-capsules/command-receipts";
import { recordWorkCapsuleActivity } from "@/lib/work-capsules/work-capsule-activity-store";
import type { CapsuleDb, WorkCapsuleActor } from "@/lib/work-capsules/work-capsule-store-types";

import { decideRuntimeCommand, type ActivityIntent, type RuntimeCommand } from "./runtime-decider";
import { readStoredRuntimeSession, type StoredRuntimeSession } from "./supervised-session";
import { insertEffects, retireEffects, settleEffect, type SqlRunner } from "./workroom-effect-store";

export type RuntimeCommitInput = { capsuleId: string; commandId: string; command: RuntimeCommand; actor: WorkCapsuleActor };

/** The stored reply, or null when the room does not exist. */
export type RuntimeCommitter = (input: RuntimeCommitInput) => Promise<Record<string, unknown> | null>;

/** A settlement from an attempt whose lease was lost: nothing is written. */
export class StaleEffectSettlementError extends Error {
  constructor(effectId: string) {
    super(`Effect ${effectId} is no longer held by this attempt.`);
    this.name = "StaleEffectSettlementError";
  }
}

class RoomNotFoundError extends Error {}

type CommitTx = CapsuleDb & {
  $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T>;
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
};

const runnerOf = (tx: CommitTx): SqlRunner => ({
  query: async <T>(sql: string, params: unknown[]) => (await tx.$queryRawUnsafe<T[]>(sql, ...params)) ?? [],
});

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
          const run = runnerOf(tx);
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
