import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CallEfficiencyReport, EfficiencyFinding } from "./analysis";
import {
  actionToWorkType,
  actionableFindings,
  buildAiOpsReviewPrompt,
  dailyAiOpsTaskId,
  findingSourceId,
  oneShotCronFor,
  SIGNAL_SOURCE_TYPE,
} from "./aiops-handoff";
import { isOneShotCron } from "@/lib/operate/cron-next-run";

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: { create: vi.fn() },
    taskArtifact: { create: vi.fn() },
    improvementSignal: { update: vi.fn() },
    scheduledAgentTask: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    scheduledJob: { upsert: vi.fn() },
  },
}));

vi.mock("@/lib/improvement-flywheel/signals", () => ({
  createOrTouchImprovementSignal: vi.fn(),
}));

vi.mock("@/lib/operate/backlog-ingest", () => ({
  ingestBacklogItem: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { createOrTouchImprovementSignal } from "@/lib/improvement-flywheel/signals";
import { ingestBacklogItem } from "@/lib/operate/backlog-ingest";
import { dispatchMcpEfficiencyAiOps } from "./aiops-handoff";

function finding(
  partial: Partial<EfficiencyFinding> &
    Pick<EfficiencyFinding, "kind" | "toolName" | "severity">,
): EfficiencyFinding {
  return {
    title: `${partial.kind} on ${partial.toolName}`,
    detail: "detail",
    evidence: { count: 20, sampleIds: ["a"] },
    recommendedAction: "add_skill",
    wasteCallEstimate: 12,
    ...partial,
  };
}

function report(findings: EfficiencyFinding[]): CallEfficiencyReport {
  return {
    windowStart: "2026-08-03T00:00:00.000Z",
    windowEnd: "2026-08-04T00:00:00.000Z",
    totalCalls: 100,
    successRate: 0.9,
    bySurface: [],
    topTools: [],
    findings,
    ledgerSufficiency: { usable: true, note: "ok" },
  };
}

describe("mcp-call-efficiency AI Ops handoff helpers", () => {
  it("maps recommended actions to backlog work types", () => {
    expect(actionToWorkType("add_skill")).toBe("skill");
    expect(actionToWorkType("merge_tools")).toBe("tool");
    expect(actionToWorkType("webhook_or_event")).toBe("tool");
    expect(actionToWorkType("fix_instructions")).toBe("doc");
    expect(actionToWorkType("investigate")).toBe("chore");
  });

  it("builds stable source ids and filters actionable findings", () => {
    expect(findingSourceId({ kind: "thrash", toolName: "get_x" })).toBe(
      "thrash:get_x",
    );
    const all = [
      finding({ kind: "thrash", toolName: "a", severity: "info" }),
      finding({ kind: "high_volume", toolName: "b", severity: "warning" }),
      finding({ kind: "retry_storm", toolName: "c", severity: "critical" }),
    ];
    expect(actionableFindings(all).map((f) => f.toolName)).toEqual(["b", "c"]);
  });

  it("builds a one-shot cron for the UTC calendar day", () => {
    const now = new Date("2026-08-04T06:15:00.000Z");
    const cron = oneShotCronFor(now);
    expect(cron).toBe("15 6 4 8 *");
    expect(isOneShotCron(cron)).toBe(true);
    expect(dailyAiOpsTaskId(now)).toBe("mcp-efficiency-aiops-20260804");
  });

  it("builds an AI Ops review prompt with filed BIs and mandate", () => {
    const findings = [
      finding({ kind: "thrash", toolName: "get_backlog_item", severity: "critical" }),
    ];
    const prompt = buildAiOpsReviewPrompt(report(findings), {
      taskRunPublicId: "TR-MCP-EFF-TEST",
      backlogItemsFiled: ["BI-MCP-EFF-1"],
      findings,
    });
    expect(prompt).toContain("AI Ops Engineer");
    expect(prompt).toContain("get_backlog_item");
    expect(prompt).toContain("BI-MCP-EFF-1");
    expect(prompt).toContain("create_backlog_item");
    expect(prompt).toContain("TR-MCP-EFF-TEST");
  });
});

describe("dispatchMcpEfficiencyAiOps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.taskRun.create).mockResolvedValue({
      id: "cuid-tr",
      taskRunId: "TR-MCP-EFF-ABCD1234",
    } as never);
    vi.mocked(prisma.taskArtifact.create).mockResolvedValue({} as never);
    vi.mocked(prisma.improvementSignal.update).mockResolvedValue({} as never);
    vi.mocked(prisma.scheduledAgentTask.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.scheduledAgentTask.create).mockResolvedValue({} as never);
    vi.mocked(prisma.scheduledJob.upsert).mockResolvedValue({} as never);
    vi.mocked(createOrTouchImprovementSignal).mockResolvedValue({
      signalId: "IS-1",
      isNew: true,
    });
    vi.mocked(ingestBacklogItem).mockResolvedValue({
      itemId: "BI-MCP-EFF-ABCD",
      id: "cuid-bi",
      created: true,
    });
  });

  it("skips when there are no warning/critical findings", async () => {
    const result = await dispatchMcpEfficiencyAiOps({
      report: report([
        finding({ kind: "high_volume", toolName: "x", severity: "info" }),
      ]),
      ownerUserId: "user-1",
      now: new Date("2026-08-04T06:15:00.000Z"),
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("no-warning-or-critical-findings");
    expect(prisma.taskRun.create).not.toHaveBeenCalled();
  });

  it("files critical BIs, touches signals, and creates a one-shot AI Ops task", async () => {
    const now = new Date("2026-08-04T06:15:00.000Z");
    const result = await dispatchMcpEfficiencyAiOps({
      report: report([
        finding({
          kind: "thrash",
          toolName: "get_backlog_item",
          severity: "critical",
          recommendedAction: "add_skill",
        }),
        finding({
          kind: "high_volume",
          toolName: "list_items",
          severity: "warning",
          recommendedAction: "merge_tools",
        }),
      ]),
      ownerUserId: "user-super",
      now,
    });

    expect(result.skipped).toBe(false);
    expect(result.taskRunPublicId).toMatch(/^TR-MCP-EFF-/);
    expect(result.reportArtifactId).toMatch(/^ta_/);
    expect(result.signalsTouched).toBe(2);
    expect(result.backlogItemsFiled).toEqual(["BI-MCP-EFF-ABCD"]);
    expect(result.agentTaskId).toBe("mcp-efficiency-aiops-20260804");
    expect(result.agentTaskCreated).toBe(true);

    expect(createOrTouchImprovementSignal).toHaveBeenCalledTimes(2);
    expect(createOrTouchImprovementSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: SIGNAL_SOURCE_TYPE,
        sourceId: "thrash:get_backlog_item",
        agentId: "platform-engineer",
      }),
    );

    expect(ingestBacklogItem).toHaveBeenCalledTimes(1);
    expect(ingestBacklogItem).toHaveBeenCalledWith(
      expect.objectContaining({
        workType: "skill",
        source: "automated-detection",
        agentId: "platform-engineer",
        origin: { kind: SIGNAL_SOURCE_TYPE, id: "thrash:get_backlog_item" },
      }),
    );

    expect(prisma.scheduledAgentTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taskId: "mcp-efficiency-aiops-20260804",
          agentId: "platform-engineer",
          ownerUserId: "user-super",
          schedule: "15 6 4 8 *",
          nextRunAt: now,
          isActive: true,
        }),
      }),
    );
  });

  it("re-arms an existing same-day AI Ops task instead of duplicating", async () => {
    vi.mocked(prisma.scheduledAgentTask.findUnique).mockResolvedValue({
      taskId: "mcp-efficiency-aiops-20260804",
      isActive: false,
    } as never);

    const now = new Date("2026-08-04T06:15:00.000Z");
    const result = await dispatchMcpEfficiencyAiOps({
      report: report([
        finding({ kind: "retry_storm", toolName: "create_x", severity: "warning" }),
      ]),
      ownerUserId: "user-super",
      now,
    });

    expect(result.agentTaskCreated).toBe(false);
    expect(prisma.scheduledAgentTask.create).not.toHaveBeenCalled();
    expect(prisma.scheduledAgentTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: "mcp-efficiency-aiops-20260804" },
        data: expect.objectContaining({ isActive: true, nextRunAt: now }),
      }),
    );
    // Warnings do not auto-file BIs
    expect(ingestBacklogItem).not.toHaveBeenCalled();
  });
});
