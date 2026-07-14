"use server";
// BI-B416B12A (EP-WORK-CONVERGENCE): post a comment on a work item and fan out
// @mention → attention notifications. The pure core lives in
// lib/work-management/mentions.ts (parse/resolve) and mention-notify.ts (roster +
// recipient selection); this server action is the DB/auth wiring.
//
// Domain errors are RETURNED as values (never thrown): Next.js strips thrown
// error messages in production, so a thrown "not_found" would surface to the
// client as a generic opaque error. The result union carries the reason instead.

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { resolveMentions } from "@/lib/work-management/mentions";
import {
  buildMentionRoster,
  mentionNotifyRecipients,
} from "@/lib/work-management/mention-notify";
import { notifyAttentionLive } from "@/lib/attention/notify-live";

export type PostWorkItemCommentResult =
  | { ok: true; messageId: string; notified: number }
  | { ok: false; error: string };

export async function postWorkItemComment(input: {
  workItemId: string;
  body: string;
}): Promise<PostWorkItemCommentResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "unauthorized" };

  const body = (input.body ?? "").trim();
  if (!body) return { ok: false, error: "empty" };

  try {
    const item = await prisma.workItem.findUnique({
      where: { id: input.workItemId },
      select: { id: true, itemId: true, title: true, assignedToUserId: true },
    });
    if (!item) return { ok: false, error: "not_found" };

    // Bounded roster: the assignee, the commenter, and everyone who has already
    // posted on this item. Keeps the @mention lookup scoped to plausible
    // participants instead of loading every user in the system.
    const priorSenders = await prisma.workItemMessage.findMany({
      where: { workItemId: item.id, senderUserId: { not: null } },
      select: { senderUserId: true },
    });
    const userIds = Array.from(
      new Set(
        [item.assignedToUserId, userId, ...priorSenders.map((m) => m.senderUserId)].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    );

    const [users, agents] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true },
      }),
      prisma.agent.findMany({
        select: { id: true, agentId: true, slugId: true, name: true },
      }),
    ]);

    const roster = buildMentionRoster(
      users.map((u) => ({ id: u.id, email: u.email ?? "" })),
      agents.map((a) => ({ id: a.id, agentId: a.agentId, slugId: a.slugId, name: a.name })),
    );
    const targets = resolveMentions(body, roster);

    const created = await prisma.workItemMessage.create({
      data: {
        workItemId: item.id,
        senderType: "user",
        senderUserId: userId,
        messageType: "comment",
        body,
        channel: "in-app",
        structuredPayload: {
          mentions: targets.map((t) => ({ handle: t.handle, type: t.type, id: t.id })),
        },
      },
      select: { messageId: true },
    });

    const recipients = mentionNotifyRecipients(targets, { excludeUserId: userId });
    for (const recipient of recipients) {
      await notifyAttentionLive({
        source: "work-item-mention",
        itemKey: `${item.itemId}:${created.messageId}`,
        userId: recipient,
        title: `You were mentioned on ${item.title}`,
        body: body.slice(0, 140),
        deepLink: `/workspace/cases/${item.itemId}`,
      });
    }

    return { ok: true, messageId: created.messageId, notified: recipients.length };
  } catch {
    // Unexpected failure (DB, etc.) — return a value, never rethrow.
    return { ok: false, error: "failed" };
  }
}
