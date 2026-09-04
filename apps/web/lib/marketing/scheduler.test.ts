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
  parseDueWindowToDate,
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

  it("suppresses planning entirely under a quiet marketing posture (BI-C26FE785)", async () => {
    const result = await planUpcomingForAssetTasks({
      organizationId: "org-1",
      proactivity: { level: "quiet", policyId: "proactivity:marketing-campaign:quiet" },
    });

    expect(result.scheduled).toBe(0);
    expect(result.suppressedByPosture).toBe(true);
    // Quiet must not even read the task list: planning then staying silent would
    // still spend budget and fill the outbound queue behind the owner's back.
    expect(vi.mocked(prisma.marketingAssetTask.findMany)).not.toHaveBeenCalled();
  });

  it("starts creative earlier under an assertive marketing posture (BI-C26FE785)", async () => {
    const createdAt = new Date(Date.now() - 60 * 60 * 1000);
    vi.mocked(prisma.marketingAssetTask.findMany).mockResolvedValue([
      { taskId: "task-1", dueWindow: "week 5", createdAt },
    ] as never);
    vi.mocked(prisma.scheduledOutboundAction.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.scheduledOutboundAction.create).mockResolvedValue({ scheduleId: "s-1" } as never);

    const result = await planUpcomingForAssetTasks({
      organizationId: "org-1",
      proactivity: { level: "assertive", policyId: "proactivity:marketing-campaign:assertive" },
    });

    expect(result.scheduled).toBe(1);
    expect(result.advanceDays).toBe(6);
    // The persisted note must state the lead time actually used, not the constant.
    const created = vi.mocked(prisma.scheduledOutboundAction.create).mock.calls[0]?.[0] as
      | { data?: { notes?: string } }
      | undefined;
    expect(created?.data?.notes).toContain("Auto-planned 6 days");
  });

  it("never schedules less under assertive than under balanced (BI-C26FE785 regression)", async () => {
    // "week 1" resolves to createdAt itself. Created 4 days ago, so balanced
    // (3-day lead) still lands in the future, but a naive assertive 6-day lead
    // would land in the past and skip the task — assertive doing LESS work.
    const createdAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    const task = [{ taskId: "task-1", dueWindow: "week 1", createdAt }] as never;

    vi.mocked(prisma.scheduledOutboundAction.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.scheduledOutboundAction.create).mockResolvedValue({ scheduleId: "s-1" } as never);

    vi.mocked(prisma.marketingAssetTask.findMany).mockResolvedValue(task);
    const balanced = await planUpcomingForAssetTasks({
      organizationId: "org-1",
      proactivity: { level: "balanced", policyId: "proactivity:marketing-campaign:balanced" },
    });

    vi.mocked(prisma.marketingAssetTask.findMany).mockResolvedValue(task);
    const assertive = await planUpcomingForAssetTasks({
      organizationId: "org-1",
      proactivity: { level: "assertive", policyId: "proactivity:marketing-campaign:assertive" },
    });

    expect(balanced.scheduled).toBe(1);
    expect(assertive.scheduled).toBeGreaterThanOrEqual(balanced.scheduled);
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

describe("parseDueWindowToDate", () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");

  it("resolves 1-based 'week N' relative to createdAt", () => {
    expect(parseDueWindowToDate("week 1", createdAt)!.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(parseDueWindowToDate("week 5", createdAt)!.toISOString()).toBe("2026-01-29T00:00:00.000Z");
  });

  it("clamps 'week 0' to week 1 instead of going a week into the past", () => {
    expect(parseDueWindowToDate("week 0", createdAt)!.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns null (never an Invalid Date) on an overflowing week/day count", () => {
    // Regression: an Invalid Date is truthy and would crash get_content_calendar
    // via toISOString(). Must be null so the task lands in `unscheduled`.
    expect(parseDueWindowToDate("week 999999999999", createdAt)).toBeNull();
    expect(parseDueWindowToDate("next 999999999999 days", createdAt)).toBeNull();
  });

  it("parses a leading YYYY-MM-DD as UTC midnight", () => {
    expect(parseDueWindowToDate("2026-07-15", createdAt)!.toISOString()).toBe("2026-07-15T00:00:00.000Z");
    expect(parseDueWindowToDate("2026-07-15T09:30:00Z", createdAt)!.toISOString()).toBe("2026-07-15T00:00:00.000Z");
  });

  it("rejects bare numbers and locale date strings (→ unscheduled) rather than misbucketing", () => {
    // "2" → new Date("2") is Feb 2001; "July 15 2026" parses in server-local TZ.
    // Both silently land tasks in the wrong week, so we return null instead.
    expect(parseDueWindowToDate("2", createdAt)).toBeNull();
    expect(parseDueWindowToDate("July 15 2026", createdAt)).toBeNull();
    expect(parseDueWindowToDate("sometime soon", createdAt)).toBeNull();
  });
});
