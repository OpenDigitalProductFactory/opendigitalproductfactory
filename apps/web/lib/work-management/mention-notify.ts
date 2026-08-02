// BI-B416B12A (EP-WORK-CONVERGENCE): turn the @mentions in a work-item comment
// into the notification fan-out — the "watch fabric" that makes @mention actually
// reach someone. Pure: resolves handles against a roster (see mentions.ts) and
// produces Notification specs for mentioned HUMANS (the Notification table is
// user-only — FK to User, no agentId) plus the list of mentioned AGENT ids (which
// have no user inbox and are surfaced to the coworker via its own pull channel,
// recorded on the message's structuredPayload). The server action persists these.

import { resolveMentions, type MentionRoster } from "./mentions";

export interface MentionNotificationSpec {
  userId: string;
  type: string;
  title: string;
  body: string;
  deepLink: string;
}

export interface MentionFanout {
  /** One Notification per mentioned human. */
  userNotifications: MentionNotificationSpec[];
  /** Mentioned coworkers — no user inbox; recorded for their pull channel. */
  mentionedAgentIds: string[];
}

export const WORK_ITEM_MENTION_NOTIFICATION_TYPE = "work-item-mention";

export function buildMentionNotifications(input: {
  body: string;
  roster: MentionRoster;
  workItemId: string;
  caseKey?: string;
  workItemTitle: string;
  actorLabel: string;
}): MentionFanout {
  const userNotifications: MentionNotificationSpec[] = [];
  const mentionedAgentIds: string[] = [];
  const seenAgents = new Set<string>();

  for (const target of resolveMentions(input.body, input.roster)) {
    if (target.type === "user") {
      userNotifications.push({
        userId: target.id,
        type: WORK_ITEM_MENTION_NOTIFICATION_TYPE,
        title: `${input.actorLabel} mentioned you`,
        body: `on “${input.workItemTitle}”`,
        deepLink: `/workspace/cases/${input.caseKey ?? input.workItemId}`,
      });
    } else if (!seenAgents.has(target.id)) {
      seenAgents.add(target.id);
      mentionedAgentIds.push(target.id);
    }
  }

  return { userNotifications, mentionedAgentIds };
}
