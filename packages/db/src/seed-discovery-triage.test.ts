import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  buildDiscoveryTriageScheduledPrompt,
  DISCOVERY_TRIAGE_AGENT_ID,
  DISCOVERY_TRIAGE_ROUTE_CONTEXT,
  DISCOVERY_TRIAGE_SCHEDULE,
  DISCOVERY_TRIAGE_TASK_ID,
  DISCOVERY_TRIAGE_TASK_TITLE,
} from "./discovery-triage-config";
import { ensureDiscoveryTriageScheduledTask } from "./seed-discovery-triage";

describe("discovery triage seed helper", () => {
  const user = {
    findFirst: vi.fn(),
  };
  const scheduledAgentTask = {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const scheduledJob = {
    upsert: vi.fn(),
  };

  beforeEach(() => {
    user.findFirst.mockReset();
    scheduledAgentTask.findUnique.mockReset();
    scheduledAgentTask.create.mockReset();
    scheduledAgentTask.update.mockReset();
    scheduledJob.upsert.mockReset();
    delete process.env.INSTALL_TIMEZONE;
  });

  afterEach(() => {
    delete process.env.INSTALL_TIMEZONE;
  });

  it("builds a scheduled prompt that invokes run_discovery_triage", () => {
    const prompt = buildDiscoveryTriageScheduledPrompt();
    expect(prompt).toContain("run_discovery_triage");
    expect(prompt).toContain("taxonomy gap");
  });

  it("creates the scheduled task for the first superuser", async () => {
    user.findFirst.mockResolvedValue({ id: "user-admin" });
    scheduledAgentTask.findUnique.mockResolvedValue(null);

    const result = await ensureDiscoveryTriageScheduledTask(
      { user, scheduledAgentTask, scheduledJob } as never,
      new Date("2026-04-25T12:00:00Z"),
    );

    expect(result).toEqual({ created: true, ownerUserId: "user-admin" });
    expect(scheduledAgentTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: DISCOVERY_TRIAGE_TASK_ID,
        agentId: DISCOVERY_TRIAGE_AGENT_ID,
        title: DISCOVERY_TRIAGE_TASK_TITLE,
        routeContext: DISCOVERY_TRIAGE_ROUTE_CONTEXT,
        schedule: DISCOVERY_TRIAGE_SCHEDULE,
        timezone: "UTC",
        ownerUserId: "user-admin",
      }),
    });
    expect(scheduledJob.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: DISCOVERY_TRIAGE_TASK_ID },
      }),
    );
  });

  it("updates the existing task and preserves nextRunAt", async () => {
    process.env.INSTALL_TIMEZONE = "America/Chicago";
    user.findFirst.mockResolvedValue({ id: "user-admin" });
    scheduledAgentTask.findUnique.mockResolvedValue({
      taskId: DISCOVERY_TRIAGE_TASK_ID,
      nextRunAt: new Date("2026-04-26T08:00:00Z"),
    });

    const result = await ensureDiscoveryTriageScheduledTask(
      { user, scheduledAgentTask, scheduledJob } as never,
      new Date("2026-04-25T12:00:00Z"),
    );

    expect(result).toEqual({ created: false, ownerUserId: "user-admin" });
    expect(scheduledAgentTask.update).toHaveBeenCalledWith({
      where: { taskId: DISCOVERY_TRIAGE_TASK_ID },
      data: expect.objectContaining({
        agentId: DISCOVERY_TRIAGE_AGENT_ID,
        timezone: "America/Chicago",
        ownerUserId: "user-admin",
        nextRunAt: new Date("2026-04-26T08:00:00Z"),
      }),
    });
  });

  it("fails loudly when no superuser exists", async () => {
    user.findFirst.mockResolvedValue(null);

    await expect(
      ensureDiscoveryTriageScheduledTask(
        { user, scheduledAgentTask, scheduledJob } as never,
        new Date("2026-04-25T12:00:00Z"),
      ),
    ).rejects.toThrow("seed: no superuser found");
  });
});
