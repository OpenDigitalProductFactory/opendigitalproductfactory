import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  create: vi.fn(),
  findNotification: vi.fn(),
  findRun: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    platformNotification: {
      create: db.create,
      findFirst: db.findNotification,
    },
    selfUpgradeRun: {
      findFirst: db.findRun,
    },
  },
}));

import { notificationMessage, notifySelfUpgradeCompletedFor, notifySelfUpgradeEvent } from "./notification";

describe("notificationMessage", () => {
  it("formats start, completion, failure, and skipped messages", () => {
    expect(
      notificationMessage({
        type: "started",
        runId: "SUR-123",
        currentSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        targetSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }),
    ).toContain("aaaaaaaaaaaa to bbbbbbbbbbbb");

    expect(
      notificationMessage({
        type: "completed",
        runId: "SUR-123",
        completedBuildIds: ["FB-1", "FB-2"],
      }),
    ).toContain("FB-1, FB-2");

    expect(notificationMessage({ type: "failed", runId: "SUR-123", reason: "health failed" }))
      .toContain("health failed");
    expect(notificationMessage({ type: "skipped", reason: "up-to-date" })).toContain("up-to-date");
  });
});

describe("notifySelfUpgradeEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists warnings only for failed upgrade events", async () => {
    db.create.mockResolvedValue({});

    await notifySelfUpgradeEvent({ type: "failed", runId: "SUR-123", reason: "health failed" });
    await notifySelfUpgradeEvent({ type: "completed", runId: "SUR-123", completedBuildIds: [] });

    expect(db.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        severity: "warning",
        category: "self-upgrade",
        subjectId: "SUR-123",
      }),
    });
    expect(db.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        severity: "info",
        category: "self-upgrade",
        subjectId: "SUR-123",
      }),
    });
  });

  it("logs notification write failures without throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    db.create.mockRejectedValue(new Error("database unavailable"));

    await expect(notifySelfUpgradeEvent({ type: "started", runId: "SUR-123" })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[self-upgrade] notification write failed:",
      expect.any(Error),
    );

    warn.mockRestore();
  });
});

describe("notifySelfUpgradeCompletedFor (BI-E7974C18)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.create.mockResolvedValue({});
  });

  it("writes one completed notification for the run that produced the serving image", async () => {
    db.findRun.mockResolvedValue({ runId: "SUR-9" });
    db.findNotification.mockResolvedValue(null);

    await notifySelfUpgradeCompletedFor("abc123");

    expect(db.findRun).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "succeeded" }),
    }));
    expect(db.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ category: "self-upgrade", subjectId: "SUR-9", message: "Portal self-upgrade SUR-9 completed." }),
    });
  });

  it("writes nothing on a restart: the run was already announced", async () => {
    db.findRun.mockResolvedValue({ runId: "SUR-9" });
    db.findNotification.mockResolvedValue({ id: "n1" });

    await notifySelfUpgradeCompletedFor("abc123");

    expect(db.create).not.toHaveBeenCalled();
  });

  it("writes nothing when no upgrade run produced this image", async () => {
    db.findRun.mockResolvedValue(null);
    await notifySelfUpgradeCompletedFor("abc123");
    await notifySelfUpgradeCompletedFor(null);
    expect(db.create).not.toHaveBeenCalled();
  });
});
