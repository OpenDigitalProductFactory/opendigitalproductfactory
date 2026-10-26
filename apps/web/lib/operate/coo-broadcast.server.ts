import { randomUUID } from "node:crypto";
import type { ToolResult } from "@/lib/mcp-tool-types";
import { planCooBroadcast, planCooBroadcastAck } from "./coo-broadcast";

type Reader = { findMany(args: unknown): Promise<Array<Record<string, unknown>>> };
type Writer = { create(args: unknown): Promise<Record<string, unknown>> };

export type CooBroadcastDb = {
  workroom: {
    findUnique(args: unknown): Promise<Record<string, unknown> | null>;
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  };
  workroomRelation: Reader;
  workroomActivity: Writer & { findFirst?(args: unknown): Promise<Record<string, unknown> | null> };
  workItem?: { findUnique(args: unknown): Promise<Record<string, unknown> | null> };
};

export type CooBroadcastMessagePoster = (input: {
  capsuleId: string;
  workItemId: string;
  body: string;
}) => Promise<void>;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function loadContainsEdges(db: CooBroadcastDb): Promise<Array<{
  fromWorkroomId: string;
  toWorkroomId: string;
  relation: "contains";
}>> {
  const rows = await db.workroomRelation.findMany({
    where: { relation: "contains" },
    select: { fromWorkroomId: true, toWorkroomId: true, relation: true },
    take: 4001,
  });
  return rows.flatMap((row) => {
    const from = str(row.fromWorkroomId);
    const to = str(row.toWorkroomId);
    return from && to && row.relation === "contains"
      ? [{ fromWorkroomId: from, toWorkroomId: to, relation: "contains" as const }]
      : [];
  });
}

/** Posts asks down `contains`. Writes the ask ledger. Never dispatches a stage. */
export async function executeCooBroadcastAsk(input: {
  db: CooBroadcastDb;
  capsuleId: string;
  body: string;
  commandKey?: string | null;
  actor: { userId: string | null; agentId: string | null };
  postMessage?: CooBroadcastMessagePoster;
}): Promise<ToolResult> {
  const root = await input.db.workroom.findUnique({
    where: { capsuleId: input.capsuleId },
    select: { id: true, capsuleId: true, workItemId: true, title: true },
  });
  if (!root) {
    return { success: false, error: "not_found", message: `No Workroom ${input.capsuleId}.` };
  }
  const commandKey = str(input.commandKey) ?? `coo-ask-${randomUUID()}`;
  const edges = await loadContainsEdges(input.db);
  const plan = planCooBroadcast({
    rootRoomId: String(root.id),
    body: input.body,
    commandKey,
    edges,
  });
  const targets = await input.db.workroom.findMany({
    where: { id: { in: plan.targets.map((row) => row.roomId) } },
    select: { id: true, capsuleId: true, workItemId: true },
    take: 501,
  });
  const byId = new Map(targets.map((row) => [String(row.id), row]));
  const posted: string[] = [];
  for (const ask of plan.asks) {
    const room = byId.get(ask.roomId);
    if (!room) continue;
    const commandScopeKey = `${ask.kind}:${room.capsuleId}`;
    const existing = input.db.workroomActivity.findFirst
      ? await input.db.workroomActivity.findFirst({ where: { commandScopeKey, commandKey } })
      : null;
    if (existing) continue;
    await input.db.workroomActivity.create({
      data: {
        workCapsuleId: String(room.id),
        kind: ask.kind,
        summary: ask.summary,
        payload: { ...ask.payload, capsuleId: room.capsuleId },
        commandScopeKey,
        commandKey,
        recordedById: input.actor.userId,
        recordedByAgentId: input.actor.agentId,
      },
    });
    const workItemId = str(room.workItemId);
    if (workItemId && input.postMessage) {
      await input.postMessage({
        capsuleId: String(room.capsuleId),
        workItemId,
        body: input.body,
      });
      posted.push(String(room.capsuleId));
    }
  }
  return {
    success: true,
    message: `Broadcast ${commandKey} asked ${plan.asks.length} room(s).`,
    data: {
      commandKey,
      asked: plan.asks.length,
      posted: posted.length,
      dispatchInvoked: plan.dispatchInvoked,
      rooms: targets.map((row) => String(row.capsuleId)),
    },
  };
}

/** Records one room's acknowledgement. Never dispatches a stage. */
export async function executeCooBroadcastAck(input: {
  db: CooBroadcastDb;
  capsuleId: string;
  commandKey: string;
  actor: { userId: string | null; agentId: string | null };
}): Promise<ToolResult> {
  const room = await input.db.workroom.findUnique({
    where: { capsuleId: input.capsuleId },
    select: { id: true, capsuleId: true },
  });
  if (!room) {
    return { success: false, error: "not_found", message: `No Workroom ${input.capsuleId}.` };
  }
  const ack = planCooBroadcastAck({ roomId: String(room.capsuleId), commandKey: input.commandKey });
  const existing = input.db.workroomActivity.findFirst
    ? await input.db.workroomActivity.findFirst({
      where: { commandScopeKey: ack.commandScopeKey, commandKey: ack.commandKey },
    })
    : null;
  if (!existing) {
    await input.db.workroomActivity.create({
      data: {
        workCapsuleId: String(room.id),
        kind: ack.kind,
        summary: ack.summary,
        payload: { capsuleId: room.capsuleId },
        commandScopeKey: ack.commandScopeKey,
        commandKey: ack.commandKey,
        recordedById: input.actor.userId,
        recordedByAgentId: input.actor.agentId,
      },
    });
  }
  return {
    success: true,
    message: `Acknowledged ${input.commandKey} for ${input.capsuleId}.`,
    data: { commandKey: input.commandKey, capsuleId: input.capsuleId, dispatchInvoked: ack.dispatchInvoked },
  };
}
