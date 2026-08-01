"use server";

// BI-B416B12A: server entry for posting a work-item comment. Assembles the real
// @mention roster (coworkers via loadRoster + workspace users) and runs the
// tested pipeline (buildMentionRoster → postWorkItemComment → notification
// fan-out). Returns a value (never throws to the client) so RSC surfaces the
// outcome rather than a stripped production error.

import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { loadRoster } from "@/lib/coworker-record/roster";
import { loadEffectiveAuthContext } from "@/lib/identity/load-effective-auth-context";
import { getGrantedCapabilities } from "@/lib/permissions";
import { buildMentionRoster } from "./mention-roster";
import { postWorkItemComment, type PostCommentDb } from "./post-work-item-comment";
import { encodeWorkCaseKey } from "./workspace-case-loader";
import { authorizeWorkspaceRoomItem } from "./workspace-room-access";

// prisma satisfies the write surface postWorkItemComment needs; the data shapes
// are validated by the pure pipeline, so a thin structural adapter is used.
const commentDb: PostCommentDb = {
  workItemMessage: { create: (args) => prisma.workItemMessage.create(args as never) },
  notification: { create: (args) => prisma.notification.create(args as never) },
};

export async function submitWorkItemComment(input: {
  workItemId: string;
  workItemTitle: string;
  caseKey: string;
  body: string;
}): Promise<
  | { ok: true; messageId: string; notifiedUserIds: string[]; mentionedAgentIds: string[] }
  | { ok: false; error: "unauthenticated" | "empty" | "forbidden" }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "unauthenticated" };
  const userId = session.user.id;

  const body = input.body.trim();
  if (!body) return { ok: false, error: "empty" };

  const [me, item, effectiveAuth] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    }),
    prisma.workItem.findUnique({
      where: { id: input.workItemId },
      select: {
        id: true,
        itemId: true,
        sourceType: true,
        sourceId: true,
        assignedToUserId: true,
        evidence: true,
      },
    }),
    loadEffectiveAuthContext({
      user: session.user,
      grantedCapabilities: getGrantedCapabilities({
        platformRole: session.user.platformRole,
        isSuperuser: session.user.isSuperuser,
      }),
      authentication: { source: "session" },
    }),
  ]);
  if (!item) return { ok: false, error: "forbidden" };
  const canonicalSourceId = item.sourceId ?? item.itemId;
  const canonicalCaseKey = encodeWorkCaseKey({
    sourceType: item.sourceType,
    sourceId: canonicalSourceId,
  });
  const actionAccess = authorizeWorkspaceRoomItem({
    requested: "action",
    item,
    userId,
    authContext: {
      principalId: effectiveAuth.principalId,
      sensitivityClearance: effectiveAuth.sensitivityClearance,
      isSuperuser: effectiveAuth.isSuperuser,
    },
  });
  if (input.caseKey !== canonicalCaseKey || actionAccess.level !== "action") {
    return { ok: false, error: "forbidden" };
  }

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
    roomRef: {
      caseKey: canonicalCaseKey,
      caseId: `${item.sourceType}:${canonicalSourceId}`,
      workItemId: item.itemId,
    },
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
