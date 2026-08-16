import { describe, it, expect, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    organization: {
      findFirst: vi.fn(async ({ where }: any) => ({ id: where.id })),
    },
    productLine: {
      findFirst: vi.fn(async ({ where }: any) => ({ id: where.id })),
    },
    product: {
      findFirst: vi.fn(async ({ where }: any) => ({ id: where.id })),
    },
    digitalProduct: {
      findFirst: vi.fn(async ({ where }: any) => ({ id: where.id })),
    },
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
import {
  scheduleAgentTaskFor,
  getScheduledAgentTasksFor,
  cancelAgentTaskFor,
  setAgentTaskActiveFor,
  rerunAgentTaskFor,
} from "./agent-task-core";
import {
  buildPlaybookPermissionDigest,
  getProductManagementPlaybook,
} from "@/lib/product-management/product-management-playbook";

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

  it("stores a typed business-product scope without putting it in prompt text", async () => {
    const { prisma } = await import("@dpf/db");
    const create = prisma.scheduledAgentTask.create as ReturnType<typeof vi.fn>;
    create.mockClear();

    const r = await scheduleAgentTaskFor("u1", {
      ...baseInput,
      organizationId: "org-1",
      businessProductId: "product-1",
    });

    expect(r.success).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-1",
          productLineId: null,
          businessProductId: "product-1",
          prompt: "p",
        }),
      }),
    );
  });

  it("rejects conflicting product-line and product scope before scheduling", async () => {
    const { prisma } = await import("@dpf/db");
    const create = prisma.scheduledAgentTask.create as ReturnType<typeof vi.fn>;
    create.mockClear();

    const r = await scheduleAgentTaskFor("u1", {
      ...baseInput,
      organizationId: "org-1",
      productLineId: "line-1",
      businessProductId: "product-1",
    });

    expect(r).toMatchObject({ success: false });
    if (!r.success) expect(r.error).toMatch(/one narrower/i);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a typed intelligence watch without organization scope or structured config", async () => {
    const { prisma } = await import("@dpf/db");
    const create = prisma.scheduledAgentTask.create as ReturnType<typeof vi.fn>;
    create.mockClear();

    const withoutScope = await scheduleAgentTaskFor("u1", {
      ...baseInput,
      taskKind: "product-intelligence-watch",
      taskConfig: { topic: "market", query: "What changed?" },
    });
    const withoutConfig = await scheduleAgentTaskFor("u1", {
      ...baseInput,
      organizationId: "org-1",
      businessProductId: "product-1",
      taskKind: "product-intelligence-watch",
      taskConfig: null,
    });

    expect(withoutScope).toMatchObject({
      success: false,
      error: expect.stringMatching(/organization scope/i),
    });
    expect(withoutConfig).toMatchObject({
      success: false,
      error: expect.stringMatching(/configuration/i),
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("requires explicit product-management scope and a current preview digest", async () => {
    const { prisma } = await import("@dpf/db");
    const create = prisma.scheduledAgentTask.create as ReturnType<typeof vi.fn>;
    create.mockClear();
    const recipe = getProductManagementPlaybook("roadmap-refresh");
    const config = {
      schemaVersion: 1 as const,
      recipeId: recipe.id,
      permissionsDigest: buildPlaybookPermissionDigest(recipe),
      minimumRefreshMinutes: 60,
    };

    const withoutScope = await scheduleAgentTaskFor("u1", {
      ...baseInput,
      taskKind: "product-management-playbook",
      taskConfig: config,
    });
    const wrongScope = await scheduleAgentTaskFor("u1", {
      ...baseInput,
      organizationId: "org-1",
      taskKind: "product-management-playbook",
      taskConfig: config,
    });
    const stalePreview = await scheduleAgentTaskFor("u1", {
      ...baseInput,
      organizationId: "org-1",
      businessProductId: "product-1",
      taskKind: "product-management-playbook",
      taskConfig: { ...config, permissionsDigest: "old" },
    });
    const valid = await scheduleAgentTaskFor("u1", {
      ...baseInput,
      organizationId: "org-1",
      businessProductId: "product-1",
      taskKind: "product-management-playbook",
      taskConfig: config,
    });

    expect(withoutScope).toMatchObject({
      success: false,
      error: expect.stringMatching(/organization scope/i),
    });
    expect(wrongScope).toMatchObject({
      success: false,
      error: expect.stringMatching(/does not support organization/i),
    });
    expect(stalePreview).toMatchObject({
      success: false,
      error: expect.stringMatching(/permission scope changed/i),
    });
    expect(valid).toMatchObject({ success: true });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taskKind: "product-management-playbook",
          taskConfig: expect.objectContaining({
            recipeId: "roadmap-refresh",
          }),
        }),
      }),
    );
  });

  it("requires organization scope and an exact typed business-analysis watch", async () => {
    const { prisma } = await import("@dpf/db");
    const create = prisma.scheduledAgentTask.create as ReturnType<typeof vi.fn>;
    create.mockClear();
    const { validateBusinessAnalysisPlan } = await import("@dpf/storefront-templates");
    const accepted = validateBusinessAnalysisPlan({
      schemaVersion: 1,
      question: "Did covers change enough to review?",
      intent: "change",
      metrics: [{ key: "covers" }],
      dimensions: [],
      filters: [],
      period: { start: "2026-08-11", end: "2026-08-11", timezone: "America/Chicago", grain: "day" },
      comparison: { basis: "prior-period" },
      sources: [{ owner: "restaurant-service", maximumAge: "PT2H" }],
      checks: [{ kind: "completeness" }, { kind: "comparison-baseline" }],
    });
    if (accepted.status !== "accepted") throw new Error("expected accepted plan");
    const taskConfig = {
      schemaVersion: 1,
      plan: accepted.plan,
      fingerprint: accepted.fingerprint,
      materiality: { mode: "relative", direction: "either", value: 0.1 },
      baseline: { value: 100, sourceWatermark: "2026-08-12T11:00:00.000Z" },
      lastEvaluation: null,
    };

    const withoutScope = await scheduleAgentTaskFor("u1", {
      ...baseInput,
      taskKind: "business-analysis-watch" as never,
      taskConfig,
    });
    const valid = await scheduleAgentTaskFor("u1", {
      ...baseInput,
      organizationId: "org-1",
      taskKind: "business-analysis-watch" as never,
      taskConfig,
    });

    expect(withoutScope).toMatchObject({
      success: false,
      error: expect.stringMatching(/organization scope/i),
    });
    expect(valid).toMatchObject({ success: true });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        taskKind: "business-analysis-watch",
        taskConfig: expect.objectContaining({ fingerprint: accepted.fingerprint }),
      }),
    }));
  });
});

describe("cancelAgentTaskFor", () => {
  it("refuses to cancel a task owned by another user", async () => {
    const { prisma } = await import("@dpf/db");
    (prisma.scheduledAgentTask.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ownerUserId: "owner",
      schedule: "0 9 * * 1",
    });
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
    (prisma.scheduledAgentTask.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ownerUserId: "u1",
      schedule: "0 9 * * 1",
    });
    const update = prisma.scheduledAgentTask.update as ReturnType<typeof vi.fn>;
    update.mockClear();

    const r = await cancelAgentTaskFor("u1", "agent-task-1");

    expect(r.success).toBe(true);
    expect(update).toHaveBeenCalledWith({
      where: { taskId: "agent-task-1" },
      data: { isActive: false, nextRunAt: null },
    });
  });
});

describe("scheduled task controls", () => {
  it("resumes an owned task on its canonical schedule", async () => {
    const { prisma } = await import("@dpf/db");
    (prisma.scheduledAgentTask.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ownerUserId: "u1",
      schedule: "0 9 * * 1",
    });

    const result = await setAgentTaskActiveFor("u1", "agent-task-1", true);

    expect(result.success).toBe(true);
    expect(prisma.scheduledAgentTask.update).toHaveBeenCalledWith({
      where: { taskId: "agent-task-1" },
      data: {
        isActive: true,
        nextRunAt: expect.any(Date),
      },
    });
    expect(prisma.scheduledJob.update).toHaveBeenCalledWith({
      where: { jobId: "agent-task-1" },
      data: {
        schedule: "0 9 * * 1",
        nextRunAt: expect.any(Date),
      },
    });
  });

  it("queues an immediate rerun only for the owner", async () => {
    const { prisma } = await import("@dpf/db");
    (prisma.scheduledAgentTask.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ownerUserId: "u1",
      schedule: "0 9 * * 1",
    });

    const result = await rerunAgentTaskFor("u1", "agent-task-1");

    expect(result.success).toBe(true);
    expect(prisma.scheduledAgentTask.update).toHaveBeenCalledWith({
      where: { taskId: "agent-task-1" },
      data: {
        isActive: true,
        nextRunAt: expect.any(Date),
      },
    });
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
        organizationId: "org-1",
        productLineId: null,
        businessProductId: "product-1",
      },
    ]);

    const r = await getScheduledAgentTasksFor("u1");

    expect(r).toHaveLength(1);
    expect(r[0]!.nextRunAt).toBe("2026-07-01T09:00:00.000Z");
    expect(r[0]!.businessProductId).toBe("product-1");
    expect(prisma.scheduledAgentTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerUserId: "u1" } }),
    );
  });
});
