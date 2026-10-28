import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scheduledAgentTaskUpdate: vi.fn(),
  scheduledJobUpdate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    scheduledAgentTask: { update: mocks.scheduledAgentTaskUpdate },
    scheduledJob: { update: mocks.scheduledJobUpdate },
  },
}));

import {
  HARNESS_EVOLUTION_ARTIFACT_KIND,
  executeHarnessEvolutionLoopTask,
  harnessEvolutionPeriodKey,
  runHarnessEvolutionLoop,
  type HarnessEvolutionDb,
} from "./harness-evolution-task";

// BI-49BC21C1 slice 1 (AC-2/AC-3): one TaskRun per UTC day carrying budget and
// spend, the ranked candidates in a typed artifact, and no model call anywhere.

const NOW = new Date("2026-10-28T04:17:00Z");

function fakeDb(overrides: { existingRun?: boolean } = {}) {
  const db = {
    improvementSignal: {
      findMany: vi.fn().mockResolvedValue([
        {
          signalId: "IS-1",
          sourceType: "mcp-call-efficiency",
          title: "Thrash: claim_nonprod_environment_lease",
          recurrenceCount: 71,
          lastSeenAt: NOW,
          toolName: "claim_nonprod_environment_lease",
          backlogItemId: "BI-MCP-EFF-9640010E",
          evidence: { severity: "critical", sampleIds: ["te-1", "te-2"] },
        },
        {
          signalId: "IS-2",
          sourceType: "platform_issue_report",
          title: "no evidence",
          recurrenceCount: 1,
          lastSeenAt: NOW,
          toolName: null,
          backlogItemId: null,
          evidence: {},
        },
      ]),
    },
    backlogItem: {
      findMany: vi.fn().mockResolvedValue([{ itemId: "BI-2C73B434", title: "seed", status: "open" }]),
    },
    taskRun: {
      findFirst: vi.fn().mockResolvedValue(overrides.existingRun ? { taskRunId: "TR-HEV-EXISTING" } : null),
      create: vi.fn().mockResolvedValue({ id: "tr-row-1", taskRunId: "TR-HEV-NEW" }),
    },
    taskArtifact: { create: vi.fn().mockResolvedValue({}) },
  };
  return db as typeof db & HarnessEvolutionDb;
}

const RUN_INPUT = {
  ownerUserId: "user-1",
  agentId: "platform-engineer",
  taskId: "harness-evolution-loop-daily",
  taskConfig: { maxCandidates: 5, seedItemIds: ["BI-2C73B434", "BI-NOT-HERE"] },
  now: NOW,
};

beforeEach(() => vi.resetAllMocks());

describe("harnessEvolutionPeriodKey", () => {
  it("is the UTC calendar day", () => {
    expect(harnessEvolutionPeriodKey(new Date("2026-10-28T23:59:59Z"))).toBe("2026-10-28");
  });
});

describe("runHarnessEvolutionLoop", () => {
  it("reads open signals inside the lookback window, newest-recurring first and bounded", async () => {
    const db = fakeDb();
    await runHarnessEvolutionLoop(db, RUN_INPUT);
    const args = db.improvementSignal.findMany.mock.calls[0]![0];
    expect(args.where).toEqual({ status: "open", lastSeenAt: { gte: new Date("2026-09-28T04:17:00Z") } });
    expect(args.orderBy).toEqual([{ recurrenceCount: "desc" }, { lastSeenAt: "desc" }]);
    expect(args.take).toBeGreaterThan(0);
    expect(db.backlogItem.findMany.mock.calls[0]![0].where).toEqual({ itemId: { in: ["BI-2C73B434", "BI-NOT-HERE"] } });
  });

  it("records one proactive TaskRun with budget, zero spend and the ranking", async () => {
    const db = fakeDb();
    const result = await runHarnessEvolutionLoop(db, RUN_INPUT);

    expect(result.idempotent).toBe(false);
    expect(result.ranked.map((c) => c.candidateKey)).toEqual(["seed:BI-2C73B434", "signal:IS-1"]);
    expect(result.rejected.map((r) => r.reason)).toEqual(["seed-missing", "no-trajectory"]);

    const run = db.taskRun.create.mock.calls[0]![0].data;
    expect(run).toMatchObject({
      userId: "user-1",
      source: "proactive",
      status: "completed",
      repeatedPatternKey: "harness-evolution:2026-10-28",
      initiatingAgentId: "platform-engineer",
      completedAt: NOW,
    });
    expect(run.progressPayload).toEqual({
      periodKey: "2026-10-28",
      budget: { maxCandidates: 5, maxProbeReplays: 20, tokenCap: 200_000, lookbackDays: 30 },
      spend: { candidatesRanked: 2, probeReplays: 0, tokens: 0 },
      ranked: 2,
      rejected: 2,
      deferred: 0,
    });

    const artifact = db.taskArtifact.create.mock.calls[0]![0].data;
    expect(artifact.taskRunId).toBe("tr-row-1");
    expect(artifact.metadata).toEqual({ kind: HARNESS_EVOLUTION_ARTIFACT_KIND, periodKey: "2026-10-28" });
    const part = (artifact.parts as Array<{ type: string; data: { ranked: unknown[]; rejected: unknown[] } }>)[0]!;
    expect(part.type).toBe(HARNESS_EVOLUTION_ARTIFACT_KIND);
    expect(part.data.ranked).toHaveLength(2);
    expect(part.data.rejected).toHaveLength(2);
  });

  it("records nothing new when today's run already exists", async () => {
    const db = fakeDb({ existingRun: true });
    const result = await runHarnessEvolutionLoop(db, RUN_INPUT);
    expect(result).toMatchObject({ idempotent: true, taskRunId: "TR-HEV-EXISTING" });
    expect(db.taskRun.findFirst.mock.calls[0]![0].where).toEqual({ repeatedPatternKey: "harness-evolution:2026-10-28" });
    expect(db.taskRun.create).not.toHaveBeenCalled();
    expect(db.taskArtifact.create).not.toHaveBeenCalled();
    expect(db.improvementSignal.findMany).not.toHaveBeenCalled();
  });

  it("skips the backlog read when no seed queue is configured", async () => {
    const db = fakeDb();
    await runHarnessEvolutionLoop(db, { ...RUN_INPUT, taskConfig: {} });
    expect(db.backlogItem.findMany).not.toHaveBeenCalled();
  });
});

describe("executeHarnessEvolutionLoopTask", () => {
  const task = {
    taskId: "harness-evolution-loop-daily",
    schedule: "17 4 * * *",
    ownerUserId: "user-1",
    agentId: "platform-engineer",
    taskConfig: { seedItemIds: [] },
  };

  it("marks the task and its job ok with a one-line summary", async () => {
    mocks.scheduledJobUpdate.mockResolvedValue({});
    const db = fakeDb();
    await executeHarnessEvolutionLoopTask(task, { now: NOW, db });
    expect(mocks.scheduledAgentTaskUpdate).toHaveBeenCalledWith({
      where: { taskId: task.taskId },
      data: expect.objectContaining({ lastRunAt: NOW, lastStatus: "ok", lastError: null, taskRunId: "TR-HEV-NEW" }),
    });
    const job = mocks.scheduledJobUpdate.mock.calls[0]![0];
    expect(job.data.lastStatus).toBe("ok");
    expect(job.data.lastRunSummary).toBe("1 candidate ranked; 1 rejected; 0 deferred; spend 0 tokens, 0 probe replays");
  });

  it("records an error instead of throwing into the scheduler", async () => {
    mocks.scheduledJobUpdate.mockResolvedValue({});
    const db = fakeDb();
    db.improvementSignal.findMany.mockRejectedValue(new Error("db down"));
    await expect(executeHarnessEvolutionLoopTask(task, { now: NOW, db })).resolves.toBeUndefined();
    expect(mocks.scheduledAgentTaskUpdate).toHaveBeenCalledWith({
      where: { taskId: task.taskId },
      data: expect.objectContaining({ lastStatus: "error", lastError: "db down" }),
    });
  });
});
