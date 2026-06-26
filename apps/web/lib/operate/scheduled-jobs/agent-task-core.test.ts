import { describe, it, expect, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    scheduledAgentTask: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    scheduledJob: {
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

// Imported after the mock so the module picks up the mocked prisma. The cron /
// allocator helpers it imports are pure (no DB), so they run for real.
import { scheduleAgentTaskFor, getScheduledAgentTasksFor, cancelAgentTaskFor } from "./agent-task-core";

const baseInput = { agentId: "a", title: "t", prompt: "p", routeContext: "/x", schedule: "0 9 1 * *" };

describe("scheduleAgentTaskFor", () => {
  it("rejects a non-UTC timezone before writing anything", async () => {
    const { prisma } = await import("@dpf/db");
    const create = prisma.scheduledAgentTask.create as ReturnType<typeof vi.fn>;
    create.mockClear();

    const r = await scheduleAgentTaskFor("u1", { ...baseInput, timezone: "America/New_York" });

    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/Non-UTC/);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a task owned by the calling user", async () => {
    const { prisma } = await import("@dpf/db");
    const create = prisma.scheduledAgentTask.create as ReturnType<typeof vi.fn>;
    (prisma.scheduledAgentTask.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    create.mockClear();

    const r = await scheduleAgentTaskFor("u1", baseInput);

    expect(r.success).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerUserId: "u1" }) }),
    );
  });
});

describe("cancelAgentTaskFor", () => {
  it("refuses to cancel a task owned by another user", async () => {
    const { prisma } = await import("@dpf/db");
    (prisma.scheduledAgentTask.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ownerUserId: "owner" });
    const update = prisma.scheduledAgentTask.update as ReturnType<typeof vi.fn>;
    update.mockClear();

    const r = await cancelAgentTaskFor("intruder", "agent-task-1");

    expect(r.success).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("returns not-found for a missing task", async () => {
    const { prisma } = await import("@dpf/db");
    (prisma.scheduledAgentTask.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const r = await cancelAgentTaskFor("u1", "nope");

    expect(r.success).toBe(false);
  });

  it("cancels a task the caller owns", async () => {
    const { prisma } = await import("@dpf/db");
    (prisma.scheduledAgentTask.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ownerUserId: "u1" });
    const update = prisma.scheduledAgentTask.update as ReturnType<typeof vi.fn>;
    update.mockClear();

    const r = await cancelAgentTaskFor("u1", "agent-task-1");

    expect(r.success).toBe(true);
    expect(update).toHaveBeenCalledWith({ where: { taskId: "agent-task-1" }, data: { isActive: false } });
  });
});

describe("getScheduledAgentTasksFor", () => {
  it("filters by owner and ISO-formats the run timestamps", async () => {
    const { prisma } = await import("@dpf/db");
    (prisma.scheduledAgentTask.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        taskId: "agent-task-1",
        agentId: "a",
        title: "t",
        prompt: "p",
        schedule: "0 9 * * *",
        isActive: true,
        nextRunAt: new Date("2026-07-01T09:00:00.000Z"),
        lastRunAt: null,
        lastStatus: null,
      },
    ]);

    const r = await getScheduledAgentTasksFor("u1");

    expect(r).toHaveLength(1);
    expect(r[0]!.nextRunAt).toBe("2026-07-01T09:00:00.000Z");
    expect(prisma.scheduledAgentTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerUserId: "u1" } }),
    );
  });
});
