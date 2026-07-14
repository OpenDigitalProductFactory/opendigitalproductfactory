"use server";

// BI-B416B12A: server entry for posting a work-item comment. Assembles the real
// @mention roster (coworkers via loadRoster + workspace users) and runs the
// tested pipeline (buildMentionRoster → postWorkItemComment → notification
// fan-out). Returns a value (never throws to the client) so RSC surfaces the
// outcome rather than a stripped production error.

import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { loadRoster } from "@/lib/coworker-record/roster";
import { buildMentionRoster } from "./mention-roster";
import { postWorkItemComment, type PostCommentDb } from "./post-work-item-comment";

// prisma satisfies the write surface postWorkItemComment needs; the data shapes
// are validated by the pure pipeline, so a thin structural adapter is used.
const commentDb: PostCommentDb = {
  workItemMessage: { create: (args) => prisma.workItemMessage.create(args as never) },
  notification: { create: (args) => prisma.notification.create(args as never) },
};

export async function submitWorkItemComment(input: {
  workItemId: string;
  workItemTitle: string;
  body: string;
}): Promise<
  | { ok: true; messageId: string; notifiedUserIds: string[]; mentionedAgentIds: string[] }
  | { ok: false; error: "unauthenticated" | "empty" }
> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "unauthenticated" };

  const body = input.body.trim();
  if (!body) return { ok: false, error: "empty" };

  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  const [rosterResult, users] = await Promise.all([
    loadRoster(),
    // User has no display-name column; the mention handle derives from the email
    // local-part (see buildMentionRoster's fallback).
    prisma.user.findMany({ select: { id: true, email: true } }),
  ]);

  const roster = buildMentionRoster({
    coworkers: rosterResult.rows.map((row) => ({
      agentId: row.agentId,
      name: row.name,
      displayName: row.displayName,
    })),
    users,
  });

  const result = await postWorkItemComment({
    db: commentDb,
    workItemId: input.workItemId,
    workItemTitle: input.workItemTitle,
    body,
    sender: {
      type: "user",
      id: userId,
      label: me?.email?.split("@")[0] || "Someone",
    },
    roster,
  });

  return { ok: true, ...result };
}
