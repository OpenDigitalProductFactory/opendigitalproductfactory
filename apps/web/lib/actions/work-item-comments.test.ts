import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    workItem: { findUnique: vi.fn() },
    agent: { findMany: vi.fn() },
    workItemMessage: { findMany: vi.fn(), create: vi.fn() },
    user: { findMany: vi.fn() },
    notification: { create: vi.fn() },
  },
}));

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";

import { postWorkItemCommentAction } from "./work-item-comments";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  workItem: { findUnique: ReturnType<typeof vi.fn> };
  agent: { findMany: ReturnType<typeof vi.fn> };
  workItemMessage: { findMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  user: { findMany: ReturnType<typeof vi.fn> };
  notification: { create: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user-1" } });
  db.workItem.findUnique.mockResolvedValue({
    id: "row-1",
    itemId: "WI-1",
    title: "Confirm condenser appointment",
    assignedToUserId: "user-2",
  });
  db.agent.findMany.mockResolvedValue([]);
  db.workItemMessage.findMany.mockResolvedValue([]);
  db.user.findMany.mockResolvedValue([
    { id: "user-1", email: "alice@example.com" },
    { id: "user-2", email: "bob@example.com" },
  ]);
  db.workItemMessage.create.mockResolvedValue({ messageId: "WIM-99" });
  db.notification.create.mockResolvedValue({});
});

describe("postWorkItemCommentAction", () => {
  it("returns unauthorized when there is no session user", async () => {
    mockAuth.mockResolvedValue(null);

    const result = await postWorkItemCommentAction({ workItemId: "row-1", body: "hi" });

    expect(result).toEqual({ ok: false, error: "unauthorized" });
    expect(db.workItem.findUnique).not.toHaveBeenCalled();
  });

  it("returns empty when the trimmed body is blank", async () => {
    const result = await postWorkItemCommentAction({ workItemId: "row-1", body: "   " });

    expect(result).toEqual({ ok: false, error: "empty" });
  });

  it("returns not_found when the work item is missing", async () => {
    db.workItem.findUnique.mockResolvedValue(null);

    const result = await postWorkItemCommentAction({ workItemId: "missing", body: "hello" });

    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("posts the comment and fans a notification out to a mentioned teammate", async () => {
    const result = await postWorkItemCommentAction({ workItemId: "row-1", body: "hey @bob please look" });

    expect(result).toEqual({ ok: true, messageId: "WIM-99", notified: 1 });
    expect(db.workItemMessage.create).toHaveBeenCalledTimes(1);
    const createArg = db.workItemMessage.create.mock.calls[0][0].data;
    expect(createArg).toMatchObject({ workItemId: "row-1", senderType: "user", senderUserId: "user-1", body: "hey @bob please look" });
    expect(db.notification.create).toHaveBeenCalledTimes(1);
    expect(db.notification.create.mock.calls[0][0].data.userId).toBe("user-2");
  });

  it("does not notify the author for self-mentions and returns zero notified", async () => {
    const result = await postWorkItemCommentAction({ workItemId: "row-1", body: "note to self @alice" });

    expect(result).toEqual({ ok: true, messageId: "WIM-99", notified: 0 });
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("returns failed instead of throwing when a DB call rejects", async () => {
    db.workItemMessage.create.mockRejectedValue(new Error("db down"));

    const result = await postWorkItemCommentAction({ workItemId: "row-1", body: "hello" });

    expect(result).toEqual({ ok: false, error: "failed" });
  });
});
