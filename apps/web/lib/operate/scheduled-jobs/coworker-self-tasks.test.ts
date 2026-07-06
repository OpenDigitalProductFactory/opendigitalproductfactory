import { describe, it, expect, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    scheduledAgentTask: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    scheduledJob: {
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

// Imported after the mock so the module picks up mocked prisma. The cron /
// allocator helpers it imports are pure (no DB), so they run for real.
import {
  reconcileCoworkerSelfTask,
  coworkerSelfTaskId,
  COWORKER_SELF_TASKS,
} from "./coworker-self-tasks";

const MKT = "marketing-specialist";

describe("coworkerSelfTaskId", () => {
  it("is deterministic per (agent, user) so reconcile stays idempotent", () => {
    expect(coworkerSelfTaskId(MKT, "u1")).toBe("self-marketing-specialist-u1");
    expect(coworkerSelfTaskId(MKT, "u1")).toBe(coworkerSelfTaskId(MKT, "u1"));
    expect(coworkerSelfTaskId(MKT, "u1")).not.toBe(coworkerSelfTaskId(MKT, "u2"));
  });
});

describe("reconcileCoworkerSelfTask", () => {
  it("does nothing for a coworker with no registered self-task", async () => {
    const { prisma } = await import("@dpf/db");
    const upsert = prisma.scheduledAgentTask.upsert as ReturnType<typeof vi.fn>;
    upsert.mockClear();

    const r = await reconcileCoworkerSelfTask("u1", "some-other-coworker", "assertive");

    expect(r).toEqual({ ok: true, action: "none" });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("assertive schedules a daily task owned by the caller", async () => {
    const { prisma } = await import("@dpf/db");
    (prisma.scheduledAgentTask.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const upsert = prisma.scheduledAgentTask.upsert as ReturnType<typeof vi.fn>;
    upsert.mockClear();

    const r = await reconcileCoworkerSelfTask("u1", MKT, "assertive");

    expect(r.action).toBe("scheduled");
    expect(r.taskId).toBe("self-marketing-specialist-u1");
    const call = upsert.mock.calls[0]![0];
    expect(call.where).toEqual({ taskId: "self-marketing-specialist-u1" });
    expect(call.create.ownerUserId).toBe("u1");
    expect(call.create.agentId).toBe(MKT);
    expect(call.create.routeContext).toBe("/customer/marketing");
    expect(call.create.isActive).toBe(true);
    // Daily cadence: cron day-of-week field is a wildcard.
    expect(call.create.schedule.split(" ")[4]).toBe("*");
  });

  it("balanced schedules a weekly task (day-of-week pinned)", async () => {
    const { prisma } = await import("@dpf/db");
    (prisma.scheduledAgentTask.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const upsert = prisma.scheduledAgentTask.upsert as ReturnType<typeof vi.fn>;
    upsert.mockClear();

    const r = await reconcileCoworkerSelfTask("u1", MKT, "balanced");

    expect(r.action).toBe("scheduled");
    const call = upsert.mock.calls[0]![0];
    // Weekly cadence: day-of-week field is a specific day, not a wildcard.
    expect(call.create.schedule.split(" ")[4]).not.toBe("*");
  });

  it("quiet stands the coworker down without creating a task", async () => {
    const { prisma } = await import("@dpf/db");
    const upsert = prisma.scheduledAgentTask.upsert as ReturnType<typeof vi.fn>;
    const updateMany = prisma.scheduledAgentTask.updateMany as ReturnType<typeof vi.fn>;
    upsert.mockClear();
    updateMany.mockClear();

    const r = await reconcileCoworkerSelfTask("u1", MKT, "quiet");

    expect(r.action).toBe("removed");
    expect(upsert).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: { taskId: "self-marketing-specialist-u1" },
      data: { isActive: false },
    });
  });

  it("registers the Marketing Strategist seed self-task", () => {
    expect(COWORKER_SELF_TASKS[MKT]).toBeDefined();
    expect(COWORKER_SELF_TASKS[MKT]!.routeContext).toBe("/customer/marketing");
    expect(COWORKER_SELF_TASKS[MKT]!.prompt).toMatch(/create_marketing_campaign_brief/);
  });
});
