import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  CollaborationFinding,
  CollaborationHealthReport,
} from "./analysis";
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
import { dispatchA2aHealthAiOps } from "./aiops-handoff";

function finding(
  partial: Partial<CollaborationFinding> &
    Pick<CollaborationFinding, "kind" | "edgeKind" | "severity">,
): CollaborationFinding {
  return {
    title: `${partial.kind} ${partial.edgeKind}`,
    detail: "detail",
    evidence: {
      count: 5,
      sampleIds: ["e1"],
      fromAgentId: "ceo",
      toAgentId: "eng",
    },
    recommendedAction: "investigate_handoff",
    wasteEdgeEstimate: 3,
    ...partial,
  };
}

function report(findings: CollaborationFinding[]): CollaborationHealthReport {
  return {
    windowStart: "2026-08-04T00:00:00.000Z",
    windowEnd: "2026-08-04T12:00:00.000Z",
    totalEdges: 20,
    successRate: 0.7,
    byKind: [],
    topPairs: [],
    findings,
    ledgerSufficiency: { usable: true, note: "ok" },
    plane: "a2a-collaboration",
  };
}

describe("a2a-collaboration-health AI Ops handoff helpers", () => {
  it("maps recommended actions to backlog work types", () => {
    expect(actionToWorkType("fix_capture")).toBe("feature");
    expect(actionToWorkType("improve_gate")).toBe("bug");
    expect(actionToWorkType("clear_stuck_delegation")).toBe("chore");
    expect(actionToWorkType("investigate_handoff")).toBe("chore");
  });

  it("builds stable source ids and filters actionable findings", () => {
    expect(
      findingSourceId({
        kind: "failed_edge",
        edgeKind: "a2a-handoff",
        evidence: { count: 1, sampleIds: [], fromAgentId: "a", toAgentId: "b" },
      }),
    ).toBe("failed_edge:a2a-handoff:a→b");
    const all = [
      finding({ kind: "failed_edge", edgeKind: "any", severity: "info" }),
      finding({ kind: "blocked_edge", edgeKind: "any", severity: "warning" }),
      finding({ kind: "stuck_active", edgeKind: "a2a-delegation", severity: "critical" }),
    ];
    expect(actionableFindings(all).map((f) => f.kind)).toEqual([
      "blocked_edge",
      "stuck_active",
    ]);
  });

  it("builds a one-shot cron for the UTC calendar day", () => {
    const now = new Date("2026-08-04T06:25:00.000Z");
    const cron = oneShotCronFor(now);
    expect(cron).toBe("25 6 4 8 *");
    expect(isOneShotCron(cron)).toBe(true);
    expect(dailyAiOpsTaskId(now)).toBe("a2a-health-aiops-20260804");
  });

  it("builds an AI Ops review prompt with mandate and ops map", () => {
    const findings = [
      finding({
        kind: "stuck_active",
        edgeKind: "a2a-delegation",
        severity: "critical",
      }),
    ];
    const prompt = buildAiOpsReviewPrompt(report(findings), {
      taskRunPublicId: "TR-A2A-HLTH-TEST",
      backlogItemsFiled: ["BI-A2A-EFF-001"],
      findings,
    });
    expect(prompt).toMatch(/AI Ops Engineer/);
    expect(prompt).toMatch(/operations-map/);
    expect(prompt).toMatch(/BI-A2A-EFF-001/);
    expect(prompt).toMatch(/do NOT invent deliberation/i);
  });

  it("exports signal source type constant", () => {
    expect(SIGNAL_SOURCE_TYPE).toBe("a2a-collaboration-health");
  });
});

describe("dispatchA2aHealthAiOps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.taskRun.create).mockResolvedValue({
      id: "tr-row",
      taskRunId: "TR-A2A-HLTH-TEST",
    } as never);
    vi.mocked(prisma.taskArtifact.create).mockResolvedValue({} as never);
    vi.mocked(createOrTouchImprovementSignal).mockResolvedValue({
      id: "sig1",
      backlogItemId: null,
      created: true,
    } as never);
    vi.mocked(ingestBacklogItem).mockResolvedValue({
      itemId: "BI-A2A-EFF-TEST",
    } as never);
    vi.mocked(prisma.improvementSignal.update).mockResolvedValue({} as never);
    vi.mocked(prisma.scheduledAgentTask.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.scheduledAgentTask.create).mockResolvedValue({} as never);
    vi.mocked(prisma.scheduledJob.upsert).mockResolvedValue({} as never);
  });

  it("skips when no warning/critical findings", async () => {
    const result = await dispatchA2aHealthAiOps({
      report: report([
        finding({ kind: "failed_edge", edgeKind: "any", severity: "info" }),
      ]),
      ownerUserId: "user-1",
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("no-warning-or-critical-findings");
    expect(prisma.taskRun.create).not.toHaveBeenCalled();
  });

  it("files critical BI, signals, and one-shot AI Ops task", async () => {
    const result = await dispatchA2aHealthAiOps({
      report: report([
        finding({
          kind: "stuck_active",
          edgeKind: "a2a-delegation",
          severity: "critical",
        }),
      ]),
      ownerUserId: "user-1",
      now: new Date("2026-08-04T06:25:00.000Z"),
    });
    expect(result.skipped).toBe(false);
    expect(result.signalsTouched).toBe(1);
    expect(result.backlogItemsFiled).toContain("BI-A2A-EFF-TEST");
    expect(result.agentTaskId).toBe("a2a-health-aiops-20260804");
    expect(result.agentTaskCreated).toBe(true);
    expect(ingestBacklogItem).toHaveBeenCalled();
    expect(createOrTouchImprovementSignal).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: SIGNAL_SOURCE_TYPE }),
    );
  });
});
