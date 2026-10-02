import { prisma, type Prisma } from "@dpf/db";

import type { ToolResult } from "@/lib/mcp-tool-types";
import { decodeWorkCaseKey } from "./case-key";
import { resolveAgentRoomAccess } from "./room-agent-access.server";

export const ROOM_MESSAGING_WORK_ITEM_SELECT = {
  id: true,
  itemId: true,
  sourceType: true,
  sourceId: true,
  title: true,
  evidence: true,
  assignedToAgentId: true,
  assignedToUserId: true,
} as const;

export type RoomMessagingWorkItem = Prisma.WorkItemGetPayload<{
  select: typeof ROOM_MESSAGING_WORK_ITEM_SELECT;
}>;

type RoomResolverDb = {
  workItem: { findFirst(args: unknown): Promise<RoomMessagingWorkItem | null> };
};

const text = (params: Record<string, unknown>, key: string) => {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

/** Resolve both user-facing room addresses to the same canonical WorkItem. */
export async function resolveRoomMessagingWorkItem(
  caseKey: string,
  db: RoomResolverDb = prisma,
): Promise<RoomMessagingWorkItem | null> {
  const decoded = decodeWorkCaseKey(caseKey);
  if (!decoded) return null;
  return db.workItem.findFirst({
    where: decoded.sourceType === "work-capsule"
      ? { capsules: { some: { capsuleId: decoded.sourceId } } }
      : { OR: [
          { sourceType: decoded.sourceType, sourceId: decoded.sourceId },
          { sourceType: decoded.sourceType, itemId: decoded.sourceId },
        ] },
    select: ROOM_MESSAGING_WORK_ITEM_SELECT,
  });
}

export type RoomParticipantInvitationPreflight =
  | { verdict: "allow"; agentId: string; caseKey: string; item: RoomMessagingWorkItem }
  | { verdict: "deny"; result: ToolResult };

/** Run deterministic invitation checks before an authority envelope exists. */
export async function preflightRoomParticipantInvitation(
  input: { params: Record<string, unknown>; userId: string; agentId?: string },
  db: RoomResolverDb = prisma,
): Promise<RoomParticipantInvitationPreflight> {
  const agentId = input.agentId;
  if (!agentId) return { verdict: "deny", result: {
    success: false, error: "invalid_caller", message: "invite_room_participant requires an acting coworker.",
  } };
  const caseKey = text(input.params, "caseKey");
  const inviteeAgentId = text(input.params, "agentId");
  const inviteeUserId = text(input.params, "userId");
  if (!caseKey || (!inviteeAgentId && !inviteeUserId)) return { verdict: "deny", result: {
    success: false, error: "invalid_input", message: "caseKey and one of agentId | userId are required.",
  } };

  const item = await resolveRoomMessagingWorkItem(caseKey, db);
  if (!item) return { verdict: "deny", result: {
    success: false, error: "not_found", message: `No Work Room found for ${caseKey}.`,
  } };
  const caller = await resolveAgentRoomAccess({
    agentId, userId: input.userId, requested: "action", workItem: item,
  });
  if (caller.decision.level === "action") return { verdict: "allow", agentId, caseKey, item };
  const reason = caller.decision.reason;
  if (reason !== "not-admitted") return { verdict: "deny", result: {
    success: false,
    error: "forbidden",
    message: `Only a room member with action rights (e.g. the Coordinator) can invite participants (${reason}).`,
  } };
  const self = inviteeAgentId === agentId;
  return { verdict: "deny", result: {
    success: false,
    error: "room_not_admitted",
    message:
      `This coworker is not admitted to ${caseKey} and ${self ? "cannot invite itself" : "cannot invite another participant"}. `
      + "The room's human owner can open Work in progress, open this room, and use Participants to choose the approved assistant. "
      + "If this connection acts for a different account, reconnect it as that owner.",
    data: { recovery: { control: "room-participants", caseKey } },
  } };
}
