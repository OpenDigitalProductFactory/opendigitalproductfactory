import { prisma, type Prisma } from "@dpf/db";

import { ensureAgentPrincipalIdentity } from "@/lib/identity/principal-linking";
import type { ToolResult } from "@/lib/mcp-tool-types";
import { decodeWorkCaseKey } from "./case-key";
import { resolveAgentRoomAccess } from "./room-agent-access.server";
import { clearanceCovers, clearanceLevelsUpTo, highestClearance } from "./room-participation";
import { resolveWorkItemRoomSensitivityCeiling } from "./room-sensitivity-ceiling.server";

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

/** An owner-approved raise of the invitee's data access to the room's level (BI-6AE64074). */
export type InviteeClearanceRaise = { agentId: string; from: string[]; to: string[]; level: string };

export type RoomParticipantInvitationPreflight =
  | { verdict: "allow"; agentId: string; caseKey: string; item: RoomMessagingWorkItem; clearanceRaise: InviteeClearanceRaise | null }
  | { verdict: "deny"; result: ToolResult };

/** The levels an invitation may raise a coworker to. Restricted stays on Coworker data access. */
const RAISABLE_LEVELS = new Set(["internal", "confidential"]);

/**
 * BI-6AE64074: name an invitee that cannot read the room before any approval
 * card exists, and plan the one-approval raise when the inviter asks for it.
 * Only a raise to exactly the room's level is accepted; clearance is otherwise
 * owner-granted under Coworker data access (decision DI-637281808D33).
 */
async function inviteeDataAccess(
  params: Record<string, unknown>,
  item: RoomMessagingWorkItem,
): Promise<{ deny: ToolResult } | { raise: InviteeClearanceRaise | null }> {
  const inviteeAgentId = text(params, "agentId");
  if (!inviteeAgentId) return { raise: null };
  const invitee = await ensureAgentPrincipalIdentity(inviteeAgentId);
  // An unknown invitee is the handler's to refuse, as before.
  if (!invitee) return { raise: null };
  const level = await resolveWorkItemRoomSensitivityCeiling(item);
  const held = (invitee.sensitivityClearance as string[] | undefined) ?? [];
  const asked = text(params, "raiseClearanceTo");
  if (asked && (asked !== level || !RAISABLE_LEVELS.has(asked))) {
    return { deny: {
      success: false,
      error: "invalid_input",
      message: RAISABLE_LEVELS.has(level)
        ? `raiseClearanceTo must be this room's level, "${level}".`
        : `An invitation cannot raise data access to "${level}". Ask the owner to grant it under Coworker data access first.`,
    } };
  }
  if (clearanceCovers(held, level)) return { raise: null };
  if (asked) {
    return { raise: { agentId: inviteeAgentId, from: held, to: [...new Set([...held, ...clearanceLevelsUpTo(level)])], level } };
  }
  const name = invitee.displayName?.trim() || inviteeAgentId;
  const current = highestClearance(held);
  return { deny: {
    success: false,
    error: "invitee_clearance_below_room",
    message: RAISABLE_LEVELS.has(level)
      ? `${name} can read ${current} information, but this room holds ${level} information, so it could not read the room. `
        + `Invite it again with raiseClearanceTo: "${level}" to ask the room's owner to admit it and give it ${level} data access in one approval.`
      : `${name} can read ${current} information, but this room holds ${level} information. `
        + "An owner must grant that under Coworker data access before it can be invited.",
    data: {
      inviteeDataAccess: current,
      roomLevel: level,
      recovery: RAISABLE_LEVELS.has(level)
        ? { param: "raiseClearanceTo", value: level }
        : { control: "coworker-data-access", recoveryUrl: "/platform/identity/agents" },
    },
  } };
}

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
  if (caller.decision.level === "action") {
    const access = await inviteeDataAccess(input.params, item);
    if ("deny" in access) return { verdict: "deny", result: access.deny };
    return { verdict: "allow", agentId, caseKey, item, clearanceRaise: access.raise };
  }
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
