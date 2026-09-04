/**
 * Room-messaging tool pack (EP-WORKROOM-COMMS, BI-3F21C4D5 + BI-4402DABB).
 *
 * Lets an admitted AI coworker POST a message into a Work Room and READ the room's
 * recent feed — the shared-room communication pattern that starts to replace
 * discrete point-to-point coordination. The room is resolved from a caseKey (an
 * external CLI executor reaches its own room via the Workroom→workItemId anchor);
 * admission is decided by room-agent-access (outcome-scoped, clearance-checked);
 * posting also heartbeats the agent's presence, which is how the CLI "joins".
 *
 * Reuses the existing WorkItemMessage writer (postWorkItemComment) with an agent
 * sender — no new write path. Design of record:
 * docs/superpowers/specs/2026-08-12-work-room-multi-agent-communication-substrate-design.md §4
 */
import { prisma } from "@dpf/db";

import type { ToolPack } from "@/lib/mcp/tool-pack";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import { ensureAgentPrincipalIdentity, syncUserPrincipal } from "@/lib/identity/principal-linking";
import { getCoworkerRoomEngagement } from "@/lib/work-management/coworker-room-engagement.server";
import { heartbeatAgentWorkItemPresence } from "@/lib/work-management/room-agent-presence.server";
import { postWorkItemComment, type PostCommentDb } from "@/lib/work-management/post-work-item-comment";
import { persistExplicitWorkroomAssignmentsForWorkItem } from "@/lib/work-management/room-participant-assignment.server";
import { appendRoomPolicyParticipant } from "@/lib/work-management/room-policy";
import type { WorkroomParticipantRole } from "@/lib/work-management/room-types";
import { resolveAgentRoomAccess } from "@/lib/work-management/room-agent-access.server";
import { decodeWorkCaseKey } from "@/lib/work-management/workspace-case-loader";

type PackContext = { agentId?: string };

function str(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

const ROOM_WORK_ITEM_SELECT = {
  id: true,
  itemId: true,
  sourceType: true,
  sourceId: true,
  title: true,
  evidence: true,
  assignedToAgentId: true,
} as const;

async function resolveRoomWorkItem(caseKey: string) {
  const decoded = decodeWorkCaseKey(caseKey);
  if (!decoded) return null;
  return prisma.workItem.findFirst({
    where: {
      OR: [
        { sourceType: decoded.sourceType, sourceId: decoded.sourceId },
        { sourceType: decoded.sourceType, itemId: decoded.sourceId },
      ],
    },
    select: ROOM_WORK_ITEM_SELECT,
  });
}

async function agentLabel(agentId: string): Promise<string> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { displayName: true } });
  return agent?.displayName?.trim() || "A coworker";
}

async function postRoomMessageHandler(
  params: Record<string, unknown>,
  _userId: string,
  context?: PackContext,
): Promise<ToolResult> {
  const agentId = context?.agentId;
  if (!agentId) {
    return { success: false, error: "invalid_caller", message: "post_room_message requires an acting coworker." };
  }
  const caseKey = str(params, "caseKey");
  const body = str(params, "body");
  if (!caseKey || !body) {
    return { success: false, error: "invalid_input", message: "caseKey and body are required." };
  }

  const item = await resolveRoomWorkItem(caseKey);
  if (!item) {
    return { success: false, error: "not_found", message: `No Work Room found for ${caseKey}.` };
  }

  const access = await resolveAgentRoomAccess({
    agentId,
    requested: "action",
    workItem: { id: item.id, evidence: item.evidence, assignedToAgentId: item.assignedToAgentId },
  });
  if (access.decision.level !== "action" || !access.agentPrincipalId) {
    return {
      success: false,
      error: "forbidden",
      message: `Not admitted to post in ${caseKey} (${access.decision.reason}). Admission is outcome-scoped per room.`,
    };
  }

  const label = await agentLabel(agentId);
  // Posting is joining: heartbeat the agent's presence in the room.
  await heartbeatAgentWorkItemPresence({ workItemId: item.id, agentPrincipalId: access.agentPrincipalId, label });

  const commentDb: PostCommentDb = {
    workItemMessage: { create: (args) => prisma.workItemMessage.create(args as never) },
    notification: { create: (args) => prisma.notification.create(args as never) },
  };
  const canonicalSourceId = item.sourceId ?? item.itemId;
  const result = await postWorkItemComment({
    db: commentDb,
    workItemId: item.id,
    workItemTitle: item.title,
    roomRef: { caseKey, caseId: `${item.sourceType}:${canonicalSourceId}`, workItemId: item.itemId },
    body,
    sender: { type: "agent", id: agentId, label },
    roster: {},
  });

  return {
    success: true,
    entityId: result.messageId,
    message: `Posted to ${caseKey} as ${label}.`,
    data: { messageId: result.messageId, workItemId: item.id },
  };
}

async function readRoomMessagesHandler(
  params: Record<string, unknown>,
  _userId: string,
  context?: PackContext,
): Promise<ToolResult> {
  const agentId = context?.agentId;
  if (!agentId) {
    return { success: false, error: "invalid_caller", message: "read_room_messages requires an acting coworker." };
  }
  const caseKey = str(params, "caseKey");
  if (!caseKey) {
    return { success: false, error: "invalid_input", message: "caseKey is required." };
  }

  const item = await resolveRoomWorkItem(caseKey);
  if (!item) {
    return { success: false, error: "not_found", message: `No Work Room found for ${caseKey}.` };
  }

  const access = await resolveAgentRoomAccess({
    agentId,
    requested: "content",
    workItem: { id: item.id, evidence: item.evidence, assignedToAgentId: item.assignedToAgentId },
  });
  if (access.decision.level !== "content") {
    return {
      success: false,
      error: "forbidden",
      message: `Not admitted to read ${caseKey} (${access.decision.reason}). Admission is outcome-scoped per room.`,
    };
  }

  const children = await prisma.workItem.findMany({ where: { parentItemId: item.id }, select: { id: true } });
  const rows = await prisma.workItemMessage.findMany({
    where: { workItemId: { in: [item.id, ...children.map((child) => child.id)] } },
    orderBy: [{ createdAt: "asc" }],
    take: 20,
    select: {
      messageId: true,
      senderType: true,
      senderUserId: true,
      senderAgentId: true,
      messageType: true,
      body: true,
      createdAt: true,
    },
  });

  return {
    success: true,
    message: `${rows.length} recent message(s) in ${caseKey}.`,
    data: {
      caseKey,
      messages: rows.map((row) => ({
        messageId: row.messageId,
        senderType: row.senderType,
        senderId: row.senderAgentId ?? row.senderUserId ?? null,
        messageType: row.messageType,
        body: row.body,
        at: row.createdAt.toISOString(),
      })),
    },
  };
}

async function inviteRoomParticipantHandler(
  params: Record<string, unknown>,
  _userId: string,
  context?: PackContext,
): Promise<ToolResult> {
  const agentId = context?.agentId;
  if (!agentId) {
    return { success: false, error: "invalid_caller", message: "invite_room_participant requires an acting coworker." };
  }
  const caseKey = str(params, "caseKey");
  const inviteeAgentId = str(params, "agentId");
  const inviteeUserId = str(params, "userId");
  if (!caseKey || (!inviteeAgentId && !inviteeUserId)) {
    return { success: false, error: "invalid_input", message: "caseKey and one of agentId | userId are required." };
  }

  const item = await resolveRoomWorkItem(caseKey);
  if (!item) {
    return { success: false, error: "not_found", message: `No Work Room found for ${caseKey}.` };
  }

  // Only a room member with action rights (the Coordinator, or an active participant) may invite.
  const caller = await resolveAgentRoomAccess({
    agentId,
    requested: "action",
    workItem: { id: item.id, evidence: item.evidence, assignedToAgentId: item.assignedToAgentId },
  });
  if (caller.decision.level !== "action") {
    return {
      success: false,
      error: "forbidden",
      message: `Only a room member with action rights (e.g. the Coordinator) can invite participants (${caller.decision.reason}).`,
    };
  }

  let inviteePrincipalId: string | null = null;
  let inviteeLabel = "A participant";
  if (inviteeAgentId) {
    const invitee = await ensureAgentPrincipalIdentity(inviteeAgentId);
    inviteePrincipalId = invitee?.principalId ?? null;
    inviteeLabel = invitee?.displayName?.trim() || "A coworker";
  } else if (inviteeUserId) {
    const invitee = await syncUserPrincipal(inviteeUserId);
    inviteePrincipalId = invitee?.principalId ?? null;
    inviteeLabel = invitee?.displayName?.trim() || "A teammate";
  }
  if (!inviteePrincipalId) {
    return { success: false, error: "not_found", message: "The invitee's principal could not be resolved." };
  }

  const canAct = params["canAct"] !== false; // default: invited to participate (post), not merely observe
  const roles: WorkroomParticipantRole[] = ["contributor"];
  const newEvidence = appendRoomPolicyParticipant(item.evidence, {
    principalRef: inviteePrincipalId,
    roles,
    canAct,
  });
  await prisma.workItem.update({ where: { id: item.id }, data: { evidence: newEvidence as never } });
  await persistExplicitWorkroomAssignmentsForWorkItem({
    workItemId: item.id,
    principalRef: inviteePrincipalId,
    roles,
    enteredReason: "Invited into the room",
  });

  const commentDb: PostCommentDb = {
    workItemMessage: { create: (args) => prisma.workItemMessage.create(args as never) },
    notification: { create: (args) => prisma.notification.create(args as never) },
  };
  const canonicalSourceId = item.sourceId ?? item.itemId;
  await postWorkItemComment({
    db: commentDb,
    workItemId: item.id,
    workItemTitle: item.title,
    roomRef: { caseKey, caseId: `${item.sourceType}:${canonicalSourceId}`, workItemId: item.itemId },
    body: `Invited ${inviteeLabel} into the room${canAct ? "" : " (read-only)"}.`,
    sender: { type: "agent", id: agentId, label: await agentLabel(agentId) },
    roster: {},
  });
  if (inviteeAgentId) {
    await heartbeatAgentWorkItemPresence({ workItemId: item.id, agentPrincipalId: inviteePrincipalId, label: inviteeLabel });
  }

  return {
    success: true,
    message: `Invited ${inviteeLabel} into ${caseKey}${canAct ? "" : " (read-only)"}.`,
    data: { caseKey, principalRef: inviteePrincipalId, canAct },
  };
}

async function getCoworkerRoomEngagementHandler(
  params: Record<string, unknown>,
  _userId: string,
  context?: PackContext,
): Promise<ToolResult> {
  const targetAgentId = str(params, "agentId") ?? context?.agentId ?? null;
  if (!targetAgentId) {
    return { success: false, error: "invalid_input", message: "agentId is required (or call as a coworker)." };
  }
  const engagement = await getCoworkerRoomEngagement({ agentId: targetAgentId });
  return {
    success: true,
    message: `${engagement.activeRoomCount} active Work Room(s) for ${targetAgentId}.`,
    data: engagement as unknown as Record<string, unknown>,
  };
}

const definitions: ToolDefinition[] = [
  {
    name: "post_room_message",
    description:
      "Post a message into a Work Room as the acting coworker. The room is addressed by caseKey (e.g. backlog-item:BI-123). You must be admitted to the room with action rights — admission is outcome-scoped per room. Posting also joins you to the room (presence). Use read_room_messages to see the feed first.",
    inputSchema: {
      type: "object",
      properties: {
        caseKey: { type: "string", description: "The room's case key, e.g. backlog-item:BI-123 (sourceType:sourceId)." },
        body: { type: "string", description: "The message text to post into the room." },
      },
      required: ["caseKey", "body"],
    },
    requiredCapability: "view_operations",
    sideEffect: true,
  },
  {
    name: "read_room_messages",
    description:
      "Read the recent message feed of a Work Room addressed by caseKey. Returns up to 20 recent messages (human and coworker). Requires content-level admission to the room; admission is outcome-scoped per room.",
    inputSchema: {
      type: "object",
      properties: {
        caseKey: { type: "string", description: "The room's case key, e.g. backlog-item:BI-123 (sourceType:sourceId)." },
      },
      required: ["caseKey"],
    },
    requiredCapability: "view_operations",
    sideEffect: false,
  },
  {
    name: "invite_room_participant",
    description:
      "Call a new participant into a Work Room on demand — invite an AI coworker (agentId) or a person (userId) into the room addressed by caseKey. Only a room member with action rights (e.g. the Coordinator) may invite. The invitee is admitted outcome-scoped to THIS room (content by default; canAct=true also lets them post). Records the join and, for a coworker, marks it present.",
    inputSchema: {
      type: "object",
      properties: {
        caseKey: { type: "string", description: "The room's case key, e.g. backlog-item:BI-123 (sourceType:sourceId)." },
        agentId: { type: "string", description: "Invite an AI coworker by agent id (provide agentId OR userId)." },
        userId: { type: "string", description: "Invite a person by user id (provide agentId OR userId)." },
        canAct: { type: "boolean", description: "Whether the invitee may post (true, default) or only read (false)." },
      },
      required: ["caseKey"],
    },
    requiredCapability: "view_operations",
    sideEffect: true,
    // changes identity or authority → consult-gated (TAK §8.4.1).
    consequence: "authority",
  },
  {
    name: "get_coworker_room_engagement",
    description:
      "Coworker 360 utilization: which active Work Rooms an AI coworker is currently engaged in and its role in each (incl. Coordinator). Defaults to the calling coworker; pass agentId to inspect another. Presence-scoped (active rooms right now). Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent id to inspect. Defaults to the calling coworker." },
      },
      required: [],
    },
    requiredCapability: "view_operations",
    sideEffect: false,
  },
];

export const roomMessagingPack: ToolPack = {
  packId: "room-messaging",
  definitions,
  handlers: {
    post_room_message: (params, userId, context) => postRoomMessageHandler(params, userId, context),
    read_room_messages: (params, userId, context) => readRoomMessagesHandler(params, userId, context),
    invite_room_participant: (params, userId, context) => inviteRoomParticipantHandler(params, userId, context),
    get_coworker_room_engagement: (params, userId, context) => getCoworkerRoomEngagementHandler(params, userId, context),
  },
  grants: {
    post_room_message: ["work_room_write"],
    read_room_messages: ["work_room_read"],
    invite_room_participant: ["work_room_write"],
    get_coworker_room_engagement: ["work_room_read"],
  },
};
