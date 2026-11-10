// BI-3C837677: the one place the workspace @mention roster is loaded, so a
// human comment (submit-work-item-comment) and an agent's room post
// (post_room_message) resolve the same handles. Before this, agent posts passed
// an empty roster and no @mention in them ever reached mentionedAgentIds.

import { prisma } from "@dpf/db";

import { loadRoster } from "@/lib/coworker-record/roster";
import { buildMentionRoster } from "./mention-roster";
import type { MentionRoster } from "./mentions";

export async function loadWorkspaceMentionRoster(): Promise<MentionRoster> {
  const [rosterResult, users] = await Promise.all([
    loadRoster(),
    // User has no display-name column; the mention handle derives from the email
    // local-part (see buildMentionRoster's fallback).
    prisma.user.findMany({ select: { id: true, email: true } }),
  ]);

  return buildMentionRoster({
    coworkers: rosterResult.rows.map((row) => ({
      agentId: row.agentId,
      name: row.name,
      displayName: row.displayName,
    })),
    users,
  });
}
