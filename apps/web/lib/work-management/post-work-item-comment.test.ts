import { describe, expect, it, vi } from "vitest";

import { postWorkItemComment, type PostCommentDb } from "./post-work-item-comment";

const roster = {
  mark: { type: "user" as const, id: "user-1" },
  "ops-coworker": { type: "agent" as const, id: "AGT-9" },
};

function fakeDb() {
  const messageCreate = vi.fn(async (_args: { data: Record<string, unknown> }) => ({ messageId: "WIM-1" }));
  const notificationCreate = vi.fn(async (_args: { data: Record<string, unknown> }) => ({}));
  const db = {
    workItemMessage: { create: messageCreate },
    notification: { create: notificationCreate },
  } as unknown as PostCommentDb;
  return { db, messageCreate, notificationCreate };
}

describe("postWorkItemComment (BI-B416B12A)", () => {
  it("writes the comment and notifies a mentioned human, records mentioned coworker", async () => {
    const { db, messageCreate, notificationCreate } = fakeDb();
    const result = await postWorkItemComment({
      db,
      workItemId: "WI-1",
      workItemTitle: "Ship the export",
      roomRef: {
        caseKey: "manual-task%3AWI-1",
        caseId: "manual-task:WI-1",
        workItemId: "WI-1",
      },
      body: "@mark can you and @ops-coworker take this?",
      sender: { type: "user", id: "author-1", label: "Alex" },
      roster,
    });

    expect(messageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workItemId: "WI-1",
        senderType: "user",
        senderUserId: "author-1",
        messageType: "comment",
        body: "@mark can you and @ops-coworker take this?",
        structuredPayload: {
          mentionedAgentIds: ["AGT-9"],
          workroom: {
            caseKey: "manual-task%3AWI-1",
            caseId: "manual-task:WI-1",
            workItemId: "WI-1",
          },
        },
      }),
    });
    expect(notificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user-1", type: "work-item-mention", deepLink: "/workspace/cases/manual-task%3AWI-1" }),
    });
    expect(result).toEqual({ messageId: "WIM-1", notifiedUserIds: ["user-1"], mentionedAgentIds: ["AGT-9"] });
  });

  it("never notifies the author of their own @mention", async () => {
    const { db, notificationCreate } = fakeDb();
    const result = await postWorkItemComment({
      db,
      workItemId: "WI-1",
      workItemTitle: "x",
      body: "note to self @mark",
      sender: { type: "user", id: "user-1", label: "Mark" }, // author IS @mark
      roster,
    });
    expect(notificationCreate).not.toHaveBeenCalled();
    expect(result.notifiedUserIds).toEqual([]);
  });

  it("omits structuredPayload when no coworker is mentioned", async () => {
    const { db, messageCreate } = fakeDb();
    await postWorkItemComment({
      db,
      workItemId: "WI-1",
      workItemTitle: "x",
      body: "just a plain comment",
      sender: { type: "agent", id: "AGT-1", label: "Ops coworker" },
      roster,
    });
    const data = messageCreate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("structuredPayload");
    expect(data).toMatchObject({ senderType: "agent", senderAgentId: "AGT-1" });
  });
});
