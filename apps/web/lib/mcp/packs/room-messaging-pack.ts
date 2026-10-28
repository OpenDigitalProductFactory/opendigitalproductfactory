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
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tool-types";
import { ensureAgentPrincipalIdentity, syncUserPrincipal } from "@/lib/identity/principal-linking";
import { getCoworkerRoomEngagement } from "@/lib/work-management/coworker-room-engagement.server";
import { loadWorkspaceMentionRoster } from "@/lib/work-management/mention-roster.server";
import { heartbeatAgentWorkItemPresence } from "@/lib/work-management/room-agent-presence.server";
import { postWorkItemComment, type PostCommentDb } from "@/lib/work-management/post-work-item-comment";
import { persistExplicitWorkroomAssignmentsForWorkItem } from "@/lib/work-management/room-participant-assignment.server";
import { appendRoomPolicyParticipant } from "@/lib/work-management/room-policy";
import { loadRoomMembersForWorkItem } from "@/lib/work-management/room-policy-members.server";
import {
  preflightRoomParticipantInvitation,
  resolveRoomMessagingWorkItem,
  ROOM_MESSAGING_WORK_ITEM_SELECT,
} from "@/lib/work-management/room-participant-invitation-preflight.server";
import { resolveAgentRoomAccess } from "@/lib/work-management/room-agent-access.server";
import { resolveAgentWorkroomAccess } from "@/lib/work-management/workroom-agent-access.server";
import { executeCooBroadcastAck, executeCooBroadcastAsk, type CooBroadcastDb } from "@/lib/operate/coo-broadcast.server";
import type { WorkroomParticipantRole } from "@/lib/work-management/room-types";

type PackContext = { agentId?: string };

function str(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

// BI-3C837677: room reads page by an opaque (createdAt, messageId) cursor.
// messageId is unique, so it breaks createdAt ties and no message is skipped or
// repeated across pages. The feed used to return the OLDEST 20 with no cursor.
const ROOM_MESSAGE_PAGE_DEFAULT = 20;
const ROOM_MESSAGE_PAGE_MAX = 100;

type RoomMessageCursor = { createdAt: Date; messageId: string };

function encodeRoomMessageCursor(row: { createdAt: Date; messageId: string }): string {
  return Buffer.from(JSON.stringify({ t: row.createdAt.toISOString(), id: row.messageId })).toString("base64url");
}

function decodeRoomMessageCursor(value: string): RoomMessageCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { t?: unknown; id?: unknown };
    if (typeof parsed.t !== "string" || typeof parsed.id !== "string" || parsed.id.length === 0) return null;
    const createdAt = new Date(parsed.t);
    return Number.isNaN(createdAt.getTime()) ? null : { createdAt, messageId: parsed.id };
  } catch {
    return null;
  }
}

function roomMessageLimit(params: Record<string, unknown>): number {
  const value = params.limit;
  if (typeof value !== "number" || !Number.isFinite(value)) return ROOM_MESSAGE_PAGE_DEFAULT;
  return Math.min(ROOM_MESSAGE_PAGE_MAX, Math.max(1, Math.floor(value)));
}

async function resolveRoomWorkItem(caseKey: string) {
  return resolveRoomMessagingWorkItem(caseKey);
}

async function agentLabel(agentId: string): Promise<string> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { displayName: true } });
  return agent?.displayName?.trim() || "A coworker";
}

async function postRoomMessageHandler(
  params: Record<string, unknown>,
  userId: string,
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
    userId,
    requested: "action",
    workItem: item,
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
    roster: await loadWorkspaceMentionRoster(),
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
  userId: string,
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
  const sinceRaw = str(params, "sinceCursor");
  const beforeRaw = str(params, "beforeCursor");
  if (sinceRaw && beforeRaw) {
    return { success: false, error: "invalid_input", message: "Pass sinceCursor or beforeCursor, not both." };
  }
  const cursorRaw = sinceRaw ?? beforeRaw;
  const cursor = cursorRaw ? decodeRoomMessageCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) {
    return {
      success: false,
      error: "invalid_input",
      message: "That cursor is not one read_room_messages issued. Pass newestCursor or oldestCursor from an earlier read unchanged.",
    };
  }
  const forward = Boolean(sinceRaw);
  const limit = roomMessageLimit(params);

  const item = await resolveRoomWorkItem(caseKey);
  if (!item) {
    return { success: false, error: "not_found", message: `No Work Room found for ${caseKey}.` };
  }

  const access = await resolveAgentRoomAccess({
    agentId,
    userId,
    requested: "content",
    workItem: item,
  });
  if (access.decision.level !== "content") {
    return {
      success: false,
      error: "forbidden",
      message: `Not admitted to read ${caseKey} (${access.decision.reason}). Admission is outcome-scoped per room.`,
    };
  }

  const children = await prisma.workItem.findMany({ where: { parentItemId: item.id }, select: ROOM_MESSAGING_WORK_ITEM_SELECT });
  const admittedChildIds: string[] = [];
  for (const child of children) {
    const childAccess = await resolveAgentRoomAccess({ agentId, userId, requested: "content", workItem: child });
    if (childAccess.decision.level === "content") admittedChildIds.push(child.id);
  }
  // since: strictly after the cursor, oldest first. Default and before: newest
  // first, strictly before the cursor when one is given. One extra row says
  // whether more remain in the paging direction.
  const comparator = forward ? "gt" : "lt";
  const direction = forward ? "asc" : "desc";
  const fetched = await prisma.workItemMessage.findMany({
    where: {
      workItemId: { in: [item.id, ...admittedChildIds] },
      ...(cursor
        ? {
            OR: [
              { createdAt: { [comparator]: cursor.createdAt } },
              { createdAt: cursor.createdAt, messageId: { [comparator]: cursor.messageId } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: direction }, { messageId: direction }],
    take: limit + 1,
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
  const hasMore = fetched.length > limit;
  const rows = fetched.slice(0, limit);
  const newestRow = forward ? rows.at(-1) : rows[0];
  const oldestRow = forward ? rows[0] : rows.at(-1);
  // An empty page keeps the caller's position rather than losing it.
  const newestCursor = newestRow ? encodeRoomMessageCursor(newestRow) : (sinceRaw ?? null);
  const oldestCursor = oldestRow ? encodeRoomMessageCursor(oldestRow) : (beforeRaw ?? null);
  const span = forward ? "new since the cursor" : cursor ? "older than the cursor" : "newest";

  return {
    success: true,
    message: `${rows.length} ${span} message(s) in ${caseKey}${hasMore ? "; more remain" : ""}.`,
    data: {
      caseKey,
      order: forward ? "oldest-first" : "newest-first",
      hasMore,
      newestCursor,
      oldestCursor,
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
  userId: string,
  context?: PackContext,
): Promise<ToolResult> {
  const preflight = await preflightRoomParticipantInvitation({ params, userId, agentId: context?.agentId });
  if (preflight.verdict === "deny") return preflight.result;
  const { agentId, caseKey, item } = preflight;
  const inviteeAgentId = str(params, "agentId");
  const inviteeUserId = str(params, "userId");

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
  }, await loadRoomMembersForWorkItem(item.id));
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

  if (inviteeAgentId) {
    const rooms = await prisma.workroom.findMany({
      where: { workItemId: item.id },
      select: { id: true, capsuleId: true },
    });
    const requested = canAct ? "action" as const : "content" as const;
    const blockedWorkrooms: Array<{ capsuleId: string; reason: string }> = [];
    const { resolveAgentWorkroomAccess } = await import("@/lib/work-management/workroom-agent-access.server");
    for (const room of rooms) {
      const { decision } = await resolveAgentWorkroomAccess({
        userId,
        agentId: inviteeAgentId,
        workroomId: room.id,
        requested,
      });
      if (decision.level !== requested) {
        blockedWorkrooms.push({ capsuleId: room.capsuleId, reason: decision.reason });
      }
    }
    if (blockedWorkrooms.length > 0) {
      const human = await syncUserPrincipal(userId);
      const needsDataAccess = blockedWorkrooms.some((room) => room.reason === "insufficient-clearance");
      return {
        success: false,
        error: "workroom_effective_admission_incomplete",
        message: needsDataAccess
          ? `Recorded ${inviteeLabel}'s membership, but the acting person and coworker still lack the required data access in ${blockedWorkrooms.map((room) => room.capsuleId).join(", ")}. Review AI Coworker Identity before continuing.`
          : `Recorded ${inviteeLabel}'s membership, but the acting person and coworker are still not both admitted to ${blockedWorkrooms.map((room) => room.capsuleId).join(", ")}. A platform manager must appoint the acting person as that room's Process Overseer before work can continue.`,
        data: {
          caseKey,
          principalRef: inviteePrincipalId,
          canAct,
          membershipRecorded: true,
          effectiveAdmission: false,
          blockedWorkrooms,
          recovery: needsDataAccess
            ? { action: "review_data_access", recoveryUrl: "/platform/identity/agents" }
            : {
                tool: "appoint_room_coordinator",
                principalRef: human?.principalId ?? null,
                requests: blockedWorkrooms.map((room) => ({
                  capsuleId: room.capsuleId,
                  principalRef: human?.principalId ?? null,
                  replaceExisting: true,
                  reason: "Recover effective paired admission for the room's active owner.",
                })),
              },
        },
      };
    }
  }

  return {
    success: true,
    message: `Invited ${inviteeLabel} into ${caseKey}${canAct ? "" : " (read-only)"}.`,
    data: {
      caseKey,
      principalRef: inviteePrincipalId,
      canAct,
      membershipRecorded: true,
      effectiveAdmission: inviteeAgentId ? true : "not-applicable",
    },
  };
}

/** The person behind the call must be able to manage the platform; the assistant borrows nothing. */
async function requirePlatformManager(userId: string): Promise<ToolResult | null> {
  const { currentUserContext } = await import("@/lib/govern/current-user-context");
  const { can } = await import("@/lib/govern/permissions");
  const human = userId ? await currentUserContext(userId) : null;
  if (!human || !can(human, "manage_platform")) {
    return { success: false, error: "forbidden", message: "Handing over an account's work needs a person with platform-management permission." };
  }
  return null;
}

async function planAccountHandoverHandler(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const refusal = await requirePlatformManager(userId);
  if (refusal) return refusal;
  const { planAccountHandover } = await import("@/lib/work-management/account-handover");
  const plan = await planAccountHandover(prisma as never, { sourceAccount: str(params, "sourceAccount") ?? "" });
  if (!plan.ok) return { success: false, error: "handover_refused", message: plan.error };
  const count = (kind: string) => plan.data.items.filter((i) => i.kind === kind).length;
  // The handover moves work, not access (BI-9D2199D4): say what stays live.
  const { accessTokens, refreshGrants } = plan.data.liveAgentCredentials;
  const access = accessTokens + refreshGrants > 0
    ? ` The account keeps its access: ${accessTokens} live agent token(s) and ${refreshGrants} refresh grant(s) stay live unless ended under Admin > Platform Development > MCP.`
    : "";
  return {
    success: true,
    message: `${plan.data.items.length} item(s) would move from ${plan.data.sourceEmail}: ${count("room")} room(s), ${count("build")} build(s), ${count("scheduled-task")} scheduled task(s). ${plan.data.refused.length} refused.${access}`,
    data: plan.data,
  };
}

async function applyAccountHandoverHandler(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const refusal = await requirePlatformManager(userId);
  if (refusal) return refusal;
  const { applyAccountHandover } = await import("@/lib/work-management/account-handover");
  const result = await applyAccountHandover(prisma as never, {
    sourceAccount: str(params, "sourceAccount") ?? "",
    digest: str(params, "digest") ?? "",
    reason: str(params, "reason") ?? "",
    actor: { userId },
  });
  if (!result.ok) return { success: false, error: "handover_refused", message: result.error };
  const { rooms, builds, scheduledTasks, failed } = result.data;
  return {
    success: failed.length === 0,
    message: `Handed over ${rooms} room(s), ${builds} build(s) and ${scheduledTasks} scheduled task(s).${failed.length ? ` ${failed.length} item(s) could not move; run the dry run again for the rest.` : ""}`,
    data: result.data,
  };
}

async function appointRoomCoordinatorHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: PackContext,
): Promise<ToolResult> {
  const capsuleId = str(params, "capsuleId");
  const principalRef = str(params, "principalRef");
  if (!capsuleId || !principalRef) {
    return {
      success: false,
      error: "invalid_input",
      message: "capsuleId and principalRef are required.",
    };
  }
  const { coordinatorAppointmentAccessRefusal } = await import(
    "@/lib/work-capsules/oauth-workroom-ownership"
  );
  const refusal = await coordinatorAppointmentAccessRefusal({
    capsuleId,
    userId,
    agentId: context?.agentId,
  });
  if (refusal) return refusal;
  const { executeCoordinatorAppointment } = await import(
    "@/lib/work-management/execute-coordinator-appointment.server"
  );
  const { COORDINATOR_ROLES } = await import("@/lib/work-management/appoint-room-coordinator");
  const result = await executeCoordinatorAppointment({
    capsuleId,
    principalRef,
    replaceExisting: params["replaceExisting"] === true,
    reason: str(params, "reason") || null,
  });
  if (!result.ok) {
    const [code] = result.error.split(":");
    return { success: false, error: code ?? "appointment_refused", message: result.error };
  }
  return {
    success: true,
    message: `${result.data.displayName} is now the Process Overseer for ${result.data.capsuleId}.`,
    data: { ...result.data, roles: COORDINATOR_ROLES },
  };
}

async function getCoworkerRoomEngagementHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: PackContext,
): Promise<ToolResult> {
  const targetAgentId = str(params, "agentId") ?? context?.agentId ?? null;
  if (!targetAgentId) {
    return { success: false, error: "invalid_input", message: "agentId is required (or call as a coworker)." };
  }
  const engagement = await getCoworkerRoomEngagement({ agentId: targetAgentId });
  const rooms = [];
  for (const room of engagement.rooms) {
    const item = await resolveRoomWorkItem(room.caseKey);
    if (!item) continue;
    const access = await resolveAgentRoomAccess({ agentId: context?.agentId ?? targetAgentId,
      userId, requested: "content", workItem: item });
    if (access.decision.level === "content") rooms.push(room);
  }
  return {
    success: true,
    message: `${rooms.length} active Work Room(s) for ${targetAgentId}.`,
    data: { ...engagement, rooms, activeRoomCount: rooms.length },
  };
}

async function broadcastWorkroomAskHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: PackContext,
): Promise<ToolResult> {
  const agentId = context?.agentId;
  if (!agentId) {
    return { success: false, error: "invalid_caller", message: "broadcast_workroom_ask requires an acting coworker." };
  }
  const capsuleId = str(params, "capsuleId");
  const body = str(params, "body");
  if (!capsuleId || !body) {
    return { success: false, error: "invalid_input", message: "capsuleId and body are required." };
  }
  const room = await prisma.workroom.findUnique({ where: { capsuleId }, select: { id: true } });
  if (!room) {
    return { success: false, error: "not_found", message: `No Workroom ${capsuleId}.` };
  }
  const access = await resolveAgentWorkroomAccess({
    userId, agentId, workroomId: room.id, requested: "action",
  });
  if (access.decision.level !== "action") {
    return {
      success: false,
      error: "forbidden",
      message: `Not admitted to broadcast from ${capsuleId} (${access.decision.reason}).`,
    };
  }
  const commentDb: PostCommentDb = {
    workItemMessage: { create: (args) => prisma.workItemMessage.create(args as never) },
    notification: { create: (args) => prisma.notification.create(args as never) },
  };
  const label = await agentLabel(agentId);
  return executeCooBroadcastAsk({
    db: prisma as CooBroadcastDb,
    capsuleId,
    body,
    commandKey: str(params, "commandKey"),
    actor: { userId, agentId },
    postMessage: async ({ capsuleId: targetCapsuleId, workItemId, body: messageBody }) => {
      const item = await prisma.workItem.findUnique({
        where: { id: workItemId },
        select: { id: true, title: true, itemId: true, sourceType: true, sourceId: true },
      });
      if (!item) return;
      await postWorkItemComment({
        db: commentDb,
        workItemId: item.id,
        workItemTitle: item.title,
        roomRef: {
          caseKey: `work-capsule:${targetCapsuleId}`,
          caseId: `${item.sourceType}:${item.sourceId ?? item.itemId}`,
          workItemId: item.itemId,
        },
        body: messageBody,
        sender: { type: "agent", id: agentId, label },
        roster: {},
      });
    },
  });
}

async function acknowledgeWorkroomBroadcastHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: PackContext,
): Promise<ToolResult> {
  const agentId = context?.agentId;
  if (!agentId) {
    return { success: false, error: "invalid_caller", message: "acknowledge_workroom_broadcast requires an acting coworker." };
  }
  const capsuleId = str(params, "capsuleId");
  const commandKey = str(params, "commandKey");
  if (!capsuleId || !commandKey) {
    return { success: false, error: "invalid_input", message: "capsuleId and commandKey are required." };
  }
  const room = await prisma.workroom.findUnique({ where: { capsuleId }, select: { id: true } });
  if (!room) {
    return { success: false, error: "not_found", message: `No Workroom ${capsuleId}.` };
  }
  const access = await resolveAgentWorkroomAccess({
    userId, agentId, workroomId: room.id, requested: "action",
  });
  if (access.decision.level !== "action") {
    return {
      success: false,
      error: "forbidden",
      message: `Not admitted to acknowledge ${commandKey} in ${capsuleId} (${access.decision.reason}).`,
    };
  }
  return executeCooBroadcastAck({
    db: prisma as CooBroadcastDb,
    capsuleId,
    commandKey,
    actor: { userId, agentId },
  });
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
      "Read a Work Room's message feed (human and coworker) by caseKey. With no cursor, returns the newest messages, newest first. Pass oldestCursor back as beforeCursor to page to older messages; pass newestCursor back as sinceCursor to get only messages posted since (oldest first). hasMore says whether more remain in that direction. Requires content-level admission to the room; admission is outcome-scoped per room.",
    inputSchema: {
      type: "object",
      properties: {
        caseKey: { type: "string", description: "The room's case key, e.g. backlog-item:BI-123 (sourceType:sourceId)." },
        sinceCursor: { type: "string", description: "A newestCursor from an earlier read. Returns only later messages, oldest first. Do not combine with beforeCursor." },
        beforeCursor: { type: "string", description: "An oldestCursor from an earlier read. Returns only earlier messages, newest first. Do not combine with sinceCursor." },
        limit: { type: "integer", minimum: 1, maximum: ROOM_MESSAGE_PAGE_MAX, description: `Messages per page (default ${ROOM_MESSAGE_PAGE_DEFAULT}, max ${ROOM_MESSAGE_PAGE_MAX}).` },
      },
      required: ["caseKey"],
    },
    requiredCapability: "view_operations",
    sideEffect: false,
  },
  {
    name: "broadcast_workroom_ask",
    description:
      "Post a COO ask down the contains hierarchy from a Workroom (capsuleId WC-*). Writes a shared commandKey ask ledger and optional room messages. Records acknowledgements separately via acknowledge_workroom_broadcast. Never dispatches a stage and never changes owners.",
    inputSchema: {
      type: "object",
      properties: {
        capsuleId: { type: "string", description: "Root Workroom id (WC-*). The ask fans out to contains descendants." },
        body: { type: "string", description: "The ask to post into each room." },
        commandKey: { type: "string", description: "Optional shared broadcast id. Minted when omitted." },
      },
      required: ["capsuleId", "body"],
    },
    requiredCapability: "view_operations",
    sideEffect: true,
  },
  {
    name: "acknowledge_workroom_broadcast",
    description:
      "Record that this Workroom acknowledged a COO broadcast commandKey. Writes the ack ledger only. Never dispatches a stage.",
    inputSchema: {
      type: "object",
      properties: {
        capsuleId: { type: "string", description: "Workroom id (WC-*) acknowledging the ask." },
        commandKey: { type: "string", description: "The shared broadcast id from broadcast_workroom_ask." },
      },
      required: ["capsuleId", "commandKey"],
    },
    requiredCapability: "view_operations",
    sideEffect: true,
  },
  {
    name: "appoint_room_coordinator",
    description:
      "Appoint the Process Overseer — the owner — of a Workroom, by capsuleId (WC-*) and principalRef (PRN-*). A room may have exactly one; conformance refuses to execute a room without one, and refuses one with several. Appointing a second is refused unless replaceExisting is set, because silently adding one leaves the room MORE stuck than before. Unlike invite_room_participant this does not require an acting coworker, so an external agent or an operator can give a stalled room an owner.",
    inputSchema: {
      type: "object",
      properties: {
        capsuleId: { type: "string", description: "Semantic Workroom id (WC-*)." },
        principalRef: { type: "string", description: "Principal id of the appointee (PRN-*). Must be an ACTIVE principal — a coworker or a person." },
        replaceExisting: { type: "boolean", description: "Hand over from the current Process Overseer. Default false, which refuses rather than creating a second." },
        reason: { type: "string", description: "Why this principal owns this room. Recorded on the participant row." },
      },
      required: ["capsuleId", "principalRef"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
    // changes who answers for a room → consult-gated (TAK §8.4.1).
    consequence: "authority",
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
  // BI-F25A5FC7: hand over everything an absent account owns, in one approval.
  {
    name: "plan_account_handover",
    description:
      "Dry run of handing over an account's live work: every live room it alone coordinates, every live Build Studio build it created, and every scheduled coworker task it owns, each with its new owner (the accountable person of the item's portfolio, then Foundational, then the organization). Items with no chosen owner are refused, never given a guessed one. It also reports the account's live agent credentials, which a handover does not revoke. Returns a digest; apply_account_handover moves exactly that set. Writes nothing.",
    inputSchema: {
      type: "object",
      properties: {
        sourceAccount: { type: "string", description: "The account handing over its work: email or user id." },
      },
      required: ["sourceAccount"],
    },
    requiredCapability: "manage_platform",
    sideEffect: false,
  },
  {
    name: "apply_account_handover",
    description:
      "Move exactly the set a plan_account_handover dry run returned to each item's new owner. Pass the dry run's digest: if the account's work changed since, nothing moves. Rooms are re-appointed through the same rule as appoint_room_coordinator; builds and scheduled tasks change owner; every item records who asked and why. Runs under the approving person's authority, who needs manage_platform.",
    inputSchema: {
      type: "object",
      properties: {
        sourceAccount: { type: "string", description: "The account handing over its work: email or user id." },
        digest: { type: "string", description: "The digest from plan_account_handover." },
        reason: { type: "string", description: "Why this account's work is being handed over. Recorded on every item." },
      },
      required: ["sourceAccount", "digest", "reason"],
    },
    requiredCapability: "manage_platform",
    sideEffect: true,
    // Changes who owns rooms, builds and scheduled work, and so who decides their approvals.
    consequence: "authority",
  },
];

export const roomMessagingPack: ToolPack = {
  packId: "room-messaging",
  definitions,
  handlers: {
    post_room_message: (params, userId, context) => postRoomMessageHandler(params, userId, context),
    read_room_messages: (params, userId, context) => readRoomMessagesHandler(params, userId, context),
    invite_room_participant: (params, userId, context) => inviteRoomParticipantHandler(params, userId, context),
    appoint_room_coordinator: (params, userId, context) => appointRoomCoordinatorHandler(params, userId, context),
    plan_account_handover: (params, userId) => planAccountHandoverHandler(params, userId),
    apply_account_handover: (params, userId) => applyAccountHandoverHandler(params, userId),
    get_coworker_room_engagement: (params, userId, context) => getCoworkerRoomEngagementHandler(params, userId, context),
    broadcast_workroom_ask: (params, userId, context) => broadcastWorkroomAskHandler(params, userId, context),
    acknowledge_workroom_broadcast: (params, userId, context) => acknowledgeWorkroomBroadcastHandler(params, userId, context),
  },
  grants: {
    post_room_message: ["work_room_write"],
    read_room_messages: ["work_room_read"],
    invite_room_participant: ["work_room_write"],
    appoint_room_coordinator: ["work_room_write"],
    plan_account_handover: ["work_room_write"],
    apply_account_handover: ["work_room_write"],
    get_coworker_room_engagement: ["work_room_read"],
    broadcast_workroom_ask: ["work_room_write"],
    acknowledge_workroom_broadcast: ["work_room_write"],
  },
};
