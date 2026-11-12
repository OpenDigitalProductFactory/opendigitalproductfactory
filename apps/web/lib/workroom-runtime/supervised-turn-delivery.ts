// BI-F5D58F29 (agent dialog broker item D, spec 2026-10-27 §7.1): the room
// message dispatcher's supervised-session half. A pending addressed message
// that names the room's supervised session becomes that session's next turn,
// carrying the room-wide messages posted since the session last heard the
// room. Anything else is planned by B2 unchanged, so a room an external
// executor holds still dispatches no platform coworker (BI-A659C3BD).

import { decodeRoomMessageCursor, encodeRoomMessageCursor } from "@/lib/work-management/room-message-cursor";
import type { RoomMessageAddressing, RoomWakePlan } from "@/lib/work-management/room-message-addressing";

import {
  buildSupervisedTurnPrompt,
  decideSupervisedTurn,
  readStoredRuntimeSession,
  SUPERVISED_TURN_CONTEXT_LIMIT,
  type RoomContextMessage,
  type StoredRuntimeSession,
  type SupervisedTurnDecision,
} from "./supervised-session";

/** The supervisor calls the dispatcher needs; production passes the portal's one supervisor. */
export interface SupervisedSessionPort {
  isLive(capsuleId: string): boolean;
  deliver(input: { capsuleId: string; prompt: string; deliveredCursor: string }): Promise<{ success: boolean; message: string }>;
}

export async function defaultSupervisedSessionPort(): Promise<SupervisedSessionPort> {
  const { workroomRuntimeSupervisor } = await import("./runtime-tools");
  return workroomRuntimeSupervisor();
}

// Structural: the server passes prisma; tests pass a fake with the same calls.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

type ContextRow = { messageId: string; senderType: string; senderAgentId: string | null; body: string; createdAt: Date; messageType: string };

function senderLabel(row: { senderType: string; senderAgentId: string | null }, gaid?: string | null): string {
  if (gaid) return gaid;
  if (row.senderAgentId) return row.senderAgentId;
  return row.senderType === "system" ? "the room" : "a person in the room";
}

/** Room-wide messages after the session's cursor (or its start) and before this one, oldest first. */
async function loadTurnContext(db: Db, args: { workItemId: string; before: { messageId: string; createdAt: Date }; after: { createdAt: Date; messageId: string | null } }): Promise<RoomContextMessage[]> {
  const rows: ContextRow[] = await db.workItemMessage.findMany({
    where: {
      workItemId: args.workItemId,
      createdAt: { gte: args.after.createdAt, lte: args.before.createdAt },
      messageId: { not: args.before.messageId },
    },
    orderBy: [{ createdAt: "desc" }, { messageId: "desc" }],
    take: SUPERVISED_TURN_CONTEXT_LIMIT + 1,
    select: { messageId: true, senderType: true, senderAgentId: true, body: true, createdAt: true, messageType: true },
  });
  return rows
    .filter((row) => row.messageId !== args.after.messageId && row.messageType !== "room-wake-notice")
    .slice(0, SUPERVISED_TURN_CONTEXT_LIMIT)
    .reverse()
    .map((row) => ({ senderLabel: senderLabel(row), body: row.body, createdAt: row.createdAt }));
}

export type SupervisedTurnOutcome =
  | { kind: "not-named" }
  | { kind: "held" | "paused"; detail: string }
  | { kind: "delivered"; addressedAs: string }
  | { kind: "failed"; addressedAs: string; detail: string };

/** Decide the supervised-session half of one message. */
export function planSupervisedTurn(args: {
  addressing: RoomMessageAddressing;
  stored: StoredRuntimeSession | null;
  /** The room's session is open in this portal process. */
  live: boolean;
  hopLimit: number;
  wakesLastHour: number;
  budgetPerHour: number;
}): SupervisedTurnDecision {
  return decideSupervisedTurn(args);
}

/**
 * Hand a named message to the session as its turn. The caller has already
 * claimed the wake (written it woken), so a retried dispatch can never give
 * the session the same message twice.
 */
export async function deliverSupervisedTurn(args: {
  db: Db;
  port: SupervisedSessionPort;
  addressedAs: string;
  room: { capsuleId: string; workspaceState: unknown };
  message: { messageId: string; workItemId: string; senderType: string; senderAgentId: string | null; body: string; createdAt: Date };
  addressing: RoomMessageAddressing;
  caseKey: string | null;
}): Promise<SupervisedTurnOutcome> {
  const stored = readStoredRuntimeSession(args.room.workspaceState);
  const cursor = stored?.deliveredCursor ? decodeRoomMessageCursor(stored.deliveredCursor) : null;
  const opened = stored?.openedAt ? new Date(stored.openedAt) : null;
  const after = cursor
    ?? { createdAt: opened && !Number.isNaN(opened.getTime()) ? opened : args.message.createdAt, messageId: null };
  const context = await loadTurnContext(args.db, { workItemId: args.message.workItemId, before: args.message, after });
  const prompt = buildSupervisedTurnPrompt({
    caseKey: args.caseKey,
    senderLabel: senderLabel(args.message, args.addressing.senderGaid),
    body: args.message.body,
    context,
  });
  try {
    const result = await args.port.deliver({ capsuleId: args.room.capsuleId, prompt, deliveredCursor: encodeRoomMessageCursor(args.message) });
    return result.success
      ? { kind: "delivered", addressedAs: args.addressedAs }
      : { kind: "failed", addressedAs: args.addressedAs, detail: result.message };
  } catch (error) {
    return { kind: "failed", addressedAs: args.addressedAs, detail: error instanceof Error ? error.message : "the turn could not start" };
  }
}

export type CombinedWake = {
  wake: Omit<RoomMessageAddressing["wake"], "at">;
  plan: RoomWakePlan["kind"] | "turn";
  woken: string[];
};

/** One wake state for the message: B2's plan for coworkers, plus what became of the supervised session. */
export function combineSupervisedWake(plan: RoomWakePlan, session: SupervisedTurnOutcome): CombinedWake {
  const coworkers = plan.kind === "wake" ? plan.agents : [];
  const withWoken = (woken: string[]) => (woken.length ? { woken } : {});
  if (session.kind === "not-named") {
    return { wake: { state: plan.state, detail: plan.detail, ...withWoken(coworkers) }, plan: plan.kind, woken: coworkers };
  }
  if (session.kind === "delivered") {
    const woken = [...coworkers, session.addressedAs];
    const detail = `${plan.kind === "wake" ? `${plan.detail} ` : ""}Delivered as a turn to ${session.addressedAs}.`;
    return { wake: { state: "woken", detail, woken }, plan: plan.kind === "wake" ? "wake" : "turn", woken };
  }
  const detail = session.kind === "failed"
    ? `${session.addressedAs} could not be given a turn (${session.detail}); the message waits on the cursor.`
    : session.detail;
  if (plan.kind === "wake" || plan.kind === "pause") {
    // B2's decision for the room's coworkers stands; the session's outcome is added to its detail.
    return { wake: { state: plan.state, detail: `${plan.detail} ${detail}`, ...withWoken(coworkers) }, plan: plan.kind, woken: coworkers };
  }
  const paused = session.kind === "paused";
  return { wake: { state: paused ? "paused-budget" : "held-for-executor", detail }, plan: paused ? "pause" : "hold", woken: [] };
}
