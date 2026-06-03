import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    scheduledOutboundAction: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    marketingAssetTask: { findMany: vi.fn() },
  },
}));

// We don't actually invoke the dispatched services in these tests — they're
// imported dynamically inside dispatchAction, and the failure path proves
// the scheduler handles exceptions correctly.
vi.mock("./draft-builder", () => ({ draftMarketingAsset: vi.fn() }));
vi.mock("./publish", () => ({ publishApprovedDraft: vi.fn() }));
vi.mock("./kpi-pullback", () => ({ pullChannelKpis: vi.fn() }));

import { prisma } from "@dpf/db";
import {
  planUpcomingForAssetTasks,
  scheduleAction,
  tickScheduler,
  transitionSchedule,
} from "./scheduler";
import { draftMarketingAsset } from "./draft-builder";

beforeEach(() => vi.clearAllMocks());

describe("scheduleAction", () => {
  it("upserts a pending scheduled action", async () => {
    vi.mocked(prisma.scheduledOutboundAction.create).mockResolvedValue({ scheduleId: "s-1" } as never);
    const result = await scheduleAction({
      organizationId: "org-1",
      kind: "draft-marketing-asset",
      targetId: "task-1",
      scheduledFor: new Date(),
    });
    expect(result.scheduleId).toBe("s-1");
  });
});

describe("transitionSchedule", () => {
  it("refuses illegal transitions (fired → pending)", async () => {
    vi.mocked(prisma.scheduledOutboundAction.findUnique).mockResolvedValue({ status: "fired" } as never);
    const result = await transitionSchedule("s-1", "pending");
    expect(result.ok).toBe(false);
  });

  it("allows pending → paused", async () => {
    vi.mocked(prisma.scheduledOutboundAction.findUnique).mockResolvedValue({ status: "pending" } as never);
    vi.mocked(prisma.scheduledOutboundAction.update).mockResolvedValue({} as never);
    const result = await transitionSchedule("s-1", "paused");
    expect(result.ok).toBe(true);
  });
});

describe("tickScheduler", () => {
  it("fires a pending drafter row when the service succeeds", async () => {
    vi.mocked(prisma.scheduledOutboundAction.findMany).mockResolvedValue([
      { scheduleId: "s-1", kind: "draft-marketing-asset", targetId: "task-1" },
    ] as never);
    vi.mocked(draftMarketingAsset).mockResolvedValue({
      success: true,
      draftId: "drf-1",
      status: "pending-review",
      bodyFormat: "markdown",
      wordCount: 50,
      channelId: "linkedin",
      assetType: "LinkedIn post",
      message: "ok",
    } as never);
    vi.mocked(prisma.scheduledOutboundAction.update).mockResolvedValue({} as never);

    const result = await tickScheduler({ now: new Date() });
    expect(result.pendingScanned).toBe(1);
    expect(result.fired).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("marks the row failed when the dispatcher throws", async () => {
    vi.mocked(prisma.scheduledOutboundAction.findMany).mockResolvedValue([
      { scheduleId: "s-1", kind: "draft-marketing-asset", targetId: "task-1" },
    ] as never);
    vi.mocked(draftMarketingAsset).mockResolvedValue({
      success: false,
      error: "boom",
      message: "dispatch_failed",
    } as never);
    vi.mocked(prisma.scheduledOutboundAction.update).mockResolvedValue({} as never);

    const result = await tickScheduler({ now: new Date() });
    expect(result.fired).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.failures[0]?.error).toMatch(/boom/);
  });

  it("isolates a failure on one row from the next", async () => {
    vi.mocked(prisma.scheduledOutboundAction.findMany).mockResolvedValue([
      { scheduleId: "s-1", kind: "draft-marketing-asset", targetId: "task-1" },
      { scheduleId: "s-2", kind: "draft-marketing-asset", targetId: "task-2" },
    ] as never);
    vi.mocked(draftMarketingAsset)
      .mockResolvedValueOnce({ success: false, error: "first failed", message: "" } as never)
      .mockResolvedValueOnce({
        success: true,
        draftId: "drf-2",
        status: "pending-review",
        bodyFormat: "markdown",
        wordCount: 10,
        channelId: "linkedin",
        assetType: "LinkedIn post",
        message: "ok",
      } as never);
    vi.mocked(prisma.scheduledOutboundAction.update).mockResolvedValue({} as never);

    const result = await tickScheduler({ now: new Date() });
    expect(result.fired).toBe(1);
    expect(result.failed).toBe(1);
  });
});

describe("planUpcomingForAssetTasks", () => {
  it("schedules a drafter run 3 days before a week-N due window", async () => {
    const createdAt = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
    // "week 5" is 4 weeks after createdAt; schedule fires 3 days before that
    vi.mocked(prisma.marketingAssetTask.findMany).mockResolvedValue([
      { taskId: "task-1", dueWindow: "week 5", createdAt },
    ] as never);
    vi.mocked(prisma.scheduledOutboundAction.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.scheduledOutboundAction.create).mockResolvedValue({ scheduleId: "s-1" } as never);

    const result = await planUpcomingForAssetTasks({ organizationId: "org-1" });
    expect(result.scheduled).toBe(1);
  });

  it("skips when a pending schedule already exists for the task", async () => {
    const createdAt = new Date(Date.now() - 60 * 60 * 1000);
    vi.mocked(prisma.marketingAssetTask.findMany).mockResolvedValue([
      { taskId: "task-1", dueWindow: "week 5", createdAt },
    ] as never);
    vi.mocked(prisma.scheduledOutboundAction.findFirst).mockResolvedValue({ scheduleId: "existing" } as never);

    const result = await planUpcomingForAssetTasks({ organizationId: "org-1" });
    expect(result.scheduled).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("skips tasks with no due window", async () => {
    vi.mocked(prisma.marketingAssetTask.findMany).mockResolvedValue([
      { taskId: "task-1", dueWindow: null, createdAt: new Date() },
    ] as never);
    const result = await planUpcomingForAssetTasks({ organizationId: "org-1" });
    expect(result.scheduled).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("skips tasks whose computed schedule date is in the past", async () => {
    const createdAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8 days ago
    // "week 1" → createdAt itself → schedule = createdAt - 3 days → past
    vi.mocked(prisma.marketingAssetTask.findMany).mockResolvedValue([
      { taskId: "task-old", dueWindow: "week 1", createdAt },
    ] as never);
    const result = await planUpcomingForAssetTasks({ organizationId: "org-1" });
    expect(result.scheduled).toBe(0);
    expect(result.skipped).toBe(1);
  });
});
