// BI-31E0C874 (agent dialog broker B2b): read_room_messages with unreadForMe.
// Kept apart from packs/room-messaging-pack.ts, which calls it after the same
// admission check and child-room admission as every read.

import type { ToolResult } from "@/lib/mcp-tool-types";
import { getAgentGaidMap } from "@/lib/identity/principal-linking";
import { roomMessageAddressingView } from "@/lib/work-management/room-message-addressing";
import { encodeRoomMessageCursor } from "@/lib/work-management/room-message-cursor";
import { readUnreadRoomMessages } from "@/lib/work-management/room-read-cursor.server";

/**
 * BI-31E0C874: what is unread for the acting coworker, oldest first. The
 * position is the coworker's own and moves forward as it reads, so two reads
 * never return the same message (design 2026-11-11-room-read-cursor §4).
 */
export async function readUnreadForMe(args: {
  caseKey: string;
  roomWorkItemId: string;
  workItemIds: string[];
  agentId: string;
  principalId: string | null;
  limit: number;
  /** Display label for the presence row, if this read creates it. */
  label: string;
}): Promise<ToolResult> {
  if (!args.principalId) {
    return { success: false, error: "forbidden", message: `Not admitted to read ${args.caseKey} as a coworker with an identity.` };
  }
  const ownGaid = (await getAgentGaidMap([args.agentId])).get(args.agentId) ?? null;
  const result = await readUnreadRoomMessages({
    roomWorkItemId: args.roomWorkItemId,
    workItemIds: args.workItemIds,
    agentId: args.agentId,
    principalId: args.principalId,
    gaid: ownGaid,
    limit: args.limit,
    label: args.label,
  });
  if (!result.ok) {
    return {
      success: false,
      error: "conflict",
      message: `Another read of ${args.caseKey} by you moved your position at the same moment. Read again; nothing was skipped.`,
    };
  }
  const page = result.data;
  const senderGaids = await getAgentGaidMap(page.messages.flatMap((row) => (row.senderAgentId ? [row.senderAgentId] : [])));
  const readCursor = page.readCursor ? encodeRoomMessageCursor(page.readCursor) : null;
  const first = page.messages[0];
  return {
    success: true,
    message: `${page.messages.length} unread message(s) for you in ${args.caseKey}${page.hasMore ? "; more remain, read again" : ""}.`,
    data: {
      caseKey: args.caseKey,
      order: "oldest-first",
      unreadForMe: true,
      hasMore: page.hasMore,
      readCursor,
      newestCursor: readCursor,
      oldestCursor: first ? encodeRoomMessageCursor(first) : null,
      messages: page.messages.map((row) => ({
        messageId: row.messageId,
        senderType: row.senderType,
        senderId: row.senderAgentId ?? row.senderUserId ?? null,
        messageType: row.messageType,
        body: row.body,
        at: row.createdAt.toISOString(),
        ...roomMessageAddressingView(row.structuredPayload, row.senderAgentId ? senderGaids.get(row.senderAgentId) ?? null : null),
      })),
    },
  };
}
