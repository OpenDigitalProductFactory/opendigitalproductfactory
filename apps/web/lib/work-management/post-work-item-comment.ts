// BI-B416B12A (EP-WORK-CONVERGENCE): the work-item comment write path with
// @mention fan-out. There was no WorkItemMessage write path in the app — comments
// existed only as a read model. This creates a comment and, from its @mentions,
// (a) writes a Notification per mentioned human (the Notification table is
// user-only) and (b) records mentioned coworker ids on the message for their pull
// channel. Structurally typed on a minimal db + an injected roster so it is
// unit-testable and callable from a "use server" wrapper that assembles the real
// roster. NOTE: a correct human roster needs a handle convention on User (email +
// name today, no @handle field) — see the plan doc; the caller supplies the roster.

import { buildMentionNotifications } from "./mention-notify";
import type { MentionRoster } from "./mentions";
import type { RoomMessageAddressing } from "./room-message-addressing";
import {
  buildCanonicalWorkroomMetadata,
  type CanonicalWorkroomRef,
} from "./room-channel-continuity";

export interface PostCommentDb {
  workItemMessage: {
    create(args: { data: Record<string, unknown> }): Promise<{ messageId: string }>;
  };
  notification: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface PostWorkItemCommentResult {
  messageId: string;
  notifiedUserIds: string[];
  mentionedAgentIds: string[];
  /** Set when the message was addressed; the caller publishes its wake after commit. */
  addressed: boolean;
}

export async function postWorkItemComment(args: {
  db: PostCommentDb;
  workItemId: string;
  workItemTitle: string;
  roomRef?: CanonicalWorkroomRef;
  body: string;
  sender: { type: "user" | "agent"; id: string; label: string };
  roster: MentionRoster;
  /**
   * BI-31C1FDEC: who the message is addressed to beyond its @mentions. Given
   * the coworkers the body mentions, returns what to store at
   * structuredPayload.addressing, or null when nothing is addressed.
   */
  addressing?: (mentionedAgentIds: string[]) => RoomMessageAddressing | null;
}): Promise<PostWorkItemCommentResult> {
  const fanout = buildMentionNotifications({
    body: args.body,
    roster: args.roster,
    workItemId: args.workItemId,
    caseKey: args.roomRef?.caseKey,
    workItemTitle: args.workItemTitle,
    actorLabel: args.sender.label,
  });

  const addressing = args.addressing?.(fanout.mentionedAgentIds) ?? null;
  const message = await args.db.workItemMessage.create({
    data: {
      workItemId: args.workItemId,
      senderType: args.sender.type,
      ...(args.sender.type === "user"
        ? { senderUserId: args.sender.id }
        : { senderAgentId: args.sender.id }),
      messageType: "comment",
      body: args.body,
      channel: "in-app",
      ...(fanout.mentionedAgentIds.length > 0 || args.roomRef || addressing
        ? {
            structuredPayload: {
              ...(fanout.mentionedAgentIds.length > 0
                ? { mentionedAgentIds: fanout.mentionedAgentIds }
                : {}),
              ...(args.roomRef ? buildCanonicalWorkroomMetadata(args.roomRef) : {}),
              ...(addressing ? { addressing } : {}),
            },
          }
        : {}),
    },
  });

  // Fan out to mentioned humans; never notify the author of their own mention.
  const notifiedUserIds: string[] = [];
  for (const spec of fanout.userNotifications) {
    if (args.sender.type === "user" && spec.userId === args.sender.id) continue;
    await args.db.notification.create({
      data: {
        userId: spec.userId,
        type: spec.type,
        title: spec.title,
        body: spec.body,
        deepLink: spec.deepLink,
      },
    });
    notifiedUserIds.push(spec.userId);
  }

  return {
    messageId: message.messageId,
    notifiedUserIds,
    mentionedAgentIds: fanout.mentionedAgentIds,
    addressed: addressing !== null,
  };
}
