"use server";

// BI-B416B12A (EP-WORK-CONVERGENCE): the "use server" wrapper that assembles the
// real @mention roster from the DB and calls the pure comment write path
// (postWorkItemComment). Domain failures are RETURNED as values, never thrown —
// Next.js strips thrown errors in production, so a thrown error would surface to
// the client as a generic opaque message with no actionable text.

import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { buildMentionRoster } from "@/lib/work-management/mention-roster";
import { postWorkItemComment } from "@/lib/work-management/post-work-item-comment";

export type PostWorkItemCommentResult =
  | { ok: true; messageId: string; notified: number }
  | { ok: false; error: string };

export async function postWorkItemCommentAction(input: {
  workItemId: string;
  body: string;
}): Promise<PostWorkItemCommentResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "unauthorized" };

  const trimmed = input.body.trim();
  if (!trimmed) return { ok: false, error: "empty" };

  try {
    const item = await prisma.workItem.findUnique({
      where: { id: input.workItemId },
      select: { id: true, itemId: true, title: true, assignedToUserId: true },
    });
    if (!item) return { ok: false, error: "not_found" };

    // Coworkers: every agent is addressable via @handle.
    const agents = await prisma.agent.findMany({
      select: { agentId: true, name: true, slugId: true },
    });
    const coworkers = agents.map((agent) => ({
      agentId: agent.agentId,
      name: agent.name,
      displayName: agent.slugId,
    }));

    // Humans: bound to this item's principals (assignee, commenter, prior
    // senders) — the User table has no @handle field, so we resolve a small,
    // relevant set rather than every user in the org.
    const priorSenders = await prisma.workItemMessage.findMany({
      where: { workItemId: item.id },
      select: { senderUserId: true },
    });
    const userIds = new Set<string>([userId]);
    if (item.assignedToUserId) userIds.add(item.assignedToUserId);
    for (const sender of priorSenders) {
      if (sender.senderUserId) userIds.add(sender.senderUserId);
    }
    const userRows = await prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, email: true },
    });
    const users = userRows.map((user) => ({ id: user.id, email: user.email, name: null }));

    const roster = buildMentionRoster({ coworkers, users });

    const commenterEmail = userRows.find((user) => user.id === userId)?.email ?? "";
    const label = commenterEmail.split("@")[0] || "someone";

    const result = await postWorkItemComment({
      db: prisma,
      workItemId: item.id,
      workItemTitle: item.title,
      body: trimmed,
      sender: { type: "user", id: userId, label },
      roster,
    });

    return { ok: true, messageId: result.messageId, notified: result.notifiedUserIds.length };
  } catch {
    return { ok: false, error: "failed" };
  }
}
