import { describe, expect, it, vi } from "vitest";
import { ensureAllBackupScheduledJobs } from "./seed-platform-backup";

describe("ensureAllBackupScheduledJobs", () => {
  it("keeps postgres schedules and deactivates retired engine schedules without deletion", async () => {
    const scheduledJob = {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      deleteMany: vi.fn(),
    };
    const result = await ensureAllBackupScheduledJobs({ scheduledJob } as never, new Date("2026-07-18T00:00:00Z"));

    expect(result).toEqual({ postgres: { created: true }, postgresTrialRestore: { created: true }, supersededDeactivated: 2 });
    expect(scheduledJob.updateMany).toHaveBeenCalledWith({
      where: { jobId: { in: ["neo4j-daily-backup", "qdrant-daily-backup"] } },
      data: { enabled: false, nextRunAt: null },
    });
    expect(scheduledJob.deleteMany).not.toHaveBeenCalled();
  });

  it("preserves an existing operator-disabled core schedule", async () => {
    const scheduledJob = { findUnique: vi.fn().mockResolvedValue({ jobId: "existing", nextRunAt: null }), create: vi.fn(), update: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 0 }) };
    await ensureAllBackupScheduledJobs({ scheduledJob } as never, new Date("2026-07-18T00:00:00Z"));
    for (const call of scheduledJob.update.mock.calls) expect(call[0].data).not.toHaveProperty("enabled");
  });
});
