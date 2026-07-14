import { describe, expect, it } from "vitest";

import { buildMentionNotifications, WORK_ITEM_MENTION_NOTIFICATION_TYPE } from "./mention-notify";

const roster = {
  mark: { type: "user" as const, id: "user-1" },
  dana: { type: "user" as const, id: "user-2" },
  "ops-coworker": { type: "agent" as const, id: "AGT-9" },
};

describe("buildMentionNotifications (BI-B416B12A)", () => {
  it("creates one notification per mentioned human, deep-linked to the work item", () => {
    const { userNotifications } = buildMentionNotifications({
      body: "hey @mark can you and @dana look at this?",
      roster,
      workItemId: "WI-1",
      workItemTitle: "Ship the export",
      actorLabel: "Alex",
    });
    expect(userNotifications).toEqual([
      {
        userId: "user-1",
        type: WORK_ITEM_MENTION_NOTIFICATION_TYPE,
        title: "Alex mentioned you",
        body: "on “Ship the export”",
        deepLink: "/workspace/cases/WI-1",
      },
      {
        userId: "user-2",
        type: WORK_ITEM_MENTION_NOTIFICATION_TYPE,
        title: "Alex mentioned you",
        body: "on “Ship the export”",
        deepLink: "/workspace/cases/WI-1",
      },
    ]);
  });

  it("routes mentioned coworkers to mentionedAgentIds (no user Notification inbox)", () => {
    const { userNotifications, mentionedAgentIds } = buildMentionNotifications({
      body: "@ops-coworker please pick this up",
      roster,
      workItemId: "WI-1",
      workItemTitle: "x",
      actorLabel: "Alex",
    });
    expect(userNotifications).toEqual([]);
    expect(mentionedAgentIds).toEqual(["AGT-9"]);
  });

  it("dedupes a repeated agent mention and drops unknown handles", () => {
    const { userNotifications, mentionedAgentIds } = buildMentionNotifications({
      body: "@ops-coworker and again @ops-coworker, cc @nobody",
      roster,
      workItemId: "WI-1",
      workItemTitle: "x",
      actorLabel: "Alex",
    });
    expect(mentionedAgentIds).toEqual(["AGT-9"]);
    expect(userNotifications).toEqual([]);
  });

  it("returns empty fan-out when nobody is mentioned", () => {
    const out = buildMentionNotifications({
      body: "just a plain comment",
      roster,
      workItemId: "WI-1",
      workItemTitle: "x",
      actorLabel: "Alex",
    });
    expect(out).toEqual({ userNotifications: [], mentionedAgentIds: [] });
  });
});
