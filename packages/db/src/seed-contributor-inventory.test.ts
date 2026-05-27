import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  CONTRIBUTOR_INVENTORY_JOB_ID,
  CONTRIBUTOR_INVENTORY_JOB_NAME,
  CONTRIBUTOR_INVENTORY_SCHEDULE,
  ensureContributorInventoryScheduledJob,
} from "./seed-contributor-inventory";

describe("contributor inventory seed helper", () => {
  const scheduledJob = {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };

  beforeEach(() => {
    scheduledJob.findUnique.mockReset();
    scheduledJob.create.mockReset();
    scheduledJob.update.mockReset();
  });

  it("creates the scheduled job on a fresh install", async () => {
    scheduledJob.findUnique.mockResolvedValue(null);

    const result = await ensureContributorInventoryScheduledJob(
      { scheduledJob } as never,
      // 14:23:45 — the next 10-minute boundary is 14:30:00.
      new Date("2026-05-26T14:23:45Z"),
    );

    expect(result).toEqual({ created: true });
    expect(scheduledJob.findUnique).toHaveBeenCalledWith({
      where: { jobId: CONTRIBUTOR_INVENTORY_JOB_ID },
      select: { jobId: true, nextRunAt: true },
    });
    expect(scheduledJob.create).toHaveBeenCalledWith({
      data: {
        jobId: CONTRIBUTOR_INVENTORY_JOB_ID,
        name: CONTRIBUTOR_INVENTORY_JOB_NAME,
        schedule: CONTRIBUTOR_INVENTORY_SCHEDULE,
        nextRunAt: new Date("2026-05-26T14:30:00Z"),
      },
    });
    expect(scheduledJob.update).not.toHaveBeenCalled();
  });

  it("rounds 14:30:00 forward to the next boundary at 14:40:00", async () => {
    scheduledJob.findUnique.mockResolvedValue(null);

    await ensureContributorInventoryScheduledJob(
      { scheduledJob } as never,
      new Date("2026-05-26T14:30:00Z"),
    );

    expect(scheduledJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        nextRunAt: new Date("2026-05-26T14:40:00Z"),
      }),
    });
  });

  it("updates name and schedule on an existing row and preserves nextRunAt", async () => {
    const preservedNextRun = new Date("2026-05-27T10:00:00Z");
    scheduledJob.findUnique.mockResolvedValue({
      jobId: CONTRIBUTOR_INVENTORY_JOB_ID,
      nextRunAt: preservedNextRun,
    });

    const result = await ensureContributorInventoryScheduledJob(
      { scheduledJob } as never,
      new Date("2026-05-26T14:23:45Z"),
    );

    expect(result).toEqual({ created: false });
    expect(scheduledJob.create).not.toHaveBeenCalled();
    expect(scheduledJob.update).toHaveBeenCalledWith({
      where: { jobId: CONTRIBUTOR_INVENTORY_JOB_ID },
      data: {
        name: CONTRIBUTOR_INVENTORY_JOB_NAME,
        schedule: CONTRIBUTOR_INVENTORY_SCHEDULE,
        nextRunAt: preservedNextRun,
      },
    });
  });

  it("backfills nextRunAt on an existing row that was missing it", async () => {
    scheduledJob.findUnique.mockResolvedValue({
      jobId: CONTRIBUTOR_INVENTORY_JOB_ID,
      nextRunAt: null,
    });

    await ensureContributorInventoryScheduledJob(
      { scheduledJob } as never,
      new Date("2026-05-26T14:23:45Z"),
    );

    expect(scheduledJob.update).toHaveBeenCalledWith({
      where: { jobId: CONTRIBUTOR_INVENTORY_JOB_ID },
      data: expect.objectContaining({
        nextRunAt: new Date("2026-05-26T14:30:00Z"),
      }),
    });
  });

  it("does not touch lastRunAt / lastStatus / lastError / metadata fields", async () => {
    scheduledJob.findUnique.mockResolvedValue({
      jobId: CONTRIBUTOR_INVENTORY_JOB_ID,
      nextRunAt: new Date("2026-05-27T10:00:00Z"),
    });

    await ensureContributorInventoryScheduledJob(
      { scheduledJob } as never,
      new Date("2026-05-26T14:23:45Z"),
    );

    const updateCall = scheduledJob.update.mock.calls[0]?.[0];
    expect(updateCall?.data).not.toHaveProperty("lastRunAt");
    expect(updateCall?.data).not.toHaveProperty("lastStatus");
    expect(updateCall?.data).not.toHaveProperty("lastError");
    expect(updateCall?.data).not.toHaveProperty("metadata");
  });
});
