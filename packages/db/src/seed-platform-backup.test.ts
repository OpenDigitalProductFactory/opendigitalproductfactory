import { describe, expect, it, vi } from "vitest";
import { ensureAllBackupScheduledJobs } from "./seed-platform-backup";

const SEED_TIME = Date.UTC(2026, 6, 18);
const HOUR_MS = 60 * 60 * 1000;

describe("ensureAllBackupScheduledJobs", () => {
  it("keeps postgres schedules and deactivates retired engine schedules without deletion", async () => {
    const scheduledJob = {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      deleteMany: vi.fn(),
    };
    const result = await ensureAllBackupScheduledJobs({ scheduledJob } as never, new Date(SEED_TIME));

    expect(result).toEqual({ postgres: { created: true }, uploads: { created: true }, postgresTrialRestore: { created: true }, supersededDeactivated: 2 });
    expect(scheduledJob.create).toHaveBeenCalledWith({
      data: {
        jobId: "uploads-daily-backup", name: "Uploads daily backup (platform-managed)",
        schedule: "daily", enabled: true, nextRunAt: new Date(SEED_TIME + 3 * HOUR_MS),
      },
    });
    expect(scheduledJob.updateMany).toHaveBeenCalledWith({
      where: { jobId: { in: ["neo4j-daily-backup", "qdrant-daily-backup"] } },
      data: { enabled: false, nextRunAt: null },
    });
    expect(scheduledJob.deleteMany).not.toHaveBeenCalled();
  });

  it("preserves an existing operator-disabled core schedule", async () => {
    const scheduledJob = { findUnique: vi.fn().mockResolvedValue({ jobId: "existing", nextRunAt: null }), create: vi.fn(), update: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 0 }) };
    await ensureAllBackupScheduledJobs({ scheduledJob } as never, new Date(SEED_TIME));
    for (const call of scheduledJob.update.mock.calls) expect(call[0].data).not.toHaveProperty("enabled");
  });

  it("does not overwrite the recorded uploads heartbeat on subsequent seed runs", async () => {
    const now = new Date(SEED_TIME);
    const nextRunAt = new Date(SEED_TIME + 51 * HOUR_MS);
    const scheduledJob = {
      findUnique: vi.fn().mockResolvedValue({ jobId: "uploads-daily-backup", nextRunAt }),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    };
    const result = await ensureAllBackupScheduledJobs({ scheduledJob } as never, now);
    expect(result).toMatchObject({ uploads: { created: false } });
    expect(scheduledJob.update).toHaveBeenCalledWith({
      where: { jobId: "uploads-daily-backup" },
      data: { name: "Uploads daily backup (platform-managed)", schedule: "daily", nextRunAt },
    });
    expect(scheduledJob.create).not.toHaveBeenCalled();
  });
});
