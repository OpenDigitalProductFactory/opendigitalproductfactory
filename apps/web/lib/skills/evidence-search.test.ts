import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  skillUsageEvent: { findMany: vi.fn() },
  toolExecution: { findMany: vi.fn() },
  taskRun: { findMany: vi.fn() },
  taskMessage: { findMany: vi.fn() },
  taskArtifact: { findMany: vi.fn() },
  agentMessage: { findMany: vi.fn() },
  platformIssueReport: { findMany: vi.fn() },
  improvementProposal: { findMany: vi.fn() },
  skillRevision: { findMany: vi.fn() },
  backlogItemActivity: { findMany: vi.fn() },
  externalEvidenceRecord: { findMany: vi.fn() },
}));

vi.mock("@dpf/db", () => ({
  prisma: prismaMock,
}));

import {
  searchSkillEvidence,
  summarizeSkillEvidenceForPrompt,
} from "./evidence-search";

const dt = (iso: string) => new Date(iso);

beforeEach(() => {
  for (const model of Object.values(prismaMock)) {
    model.findMany.mockReset();
    model.findMany.mockResolvedValue([]);
  }
});

describe("searchSkillEvidence", () => {
  it("returns normalized skill evidence newest-first across usage, tools, proposals, and revisions", async () => {
    prismaMock.skillUsageEvent.findMany.mockResolvedValue([
      {
        id: "sue-row-1",
        eventId: "SUE-1",
        skillId: "build-page",
        agentId: "AGT-BUILD",
        userId: "user-1",
        threadId: "thread-1",
        taskRunId: "TR-1",
        toolExecutionId: "tool-1",
        routeContext: "/build",
        phase: "failed",
        source: "coworker",
        metadata: { reason: "patch timeout" },
        createdAt: dt("2026-05-15T12:00:00.000Z"),
      },
    ]);
    prismaMock.toolExecution.findMany.mockResolvedValue([
      {
        id: "tool-1",
        threadId: "thread-1",
        agentId: "AGT-BUILD",
        userId: "user-1",
        toolName: "apply_patch",
        success: false,
        executionMode: "governed",
        routeContext: "/build",
        durationMs: 1200,
        taskRunId: "TR-1",
        skillId: "build-page",
        summary: "Patch failed after timeout",
        result: { error: "timeout" },
        parameters: { files: ["apps/web/page.tsx"] },
        createdAt: dt("2026-05-15T12:05:00.000Z"),
      },
    ]);
    prismaMock.improvementProposal.findMany.mockResolvedValue([
      {
        id: "proposal-row-1",
        proposalId: "IP-SKL-1",
        title: "Tighten build-page retry guidance",
        description: "Use clearer retry guidance when patching fails.",
        category: "skill",
        severity: "high",
        submittedById: "user-1",
        agentId: "AGT-BUILD",
        routeContext: "/build",
        threadId: "thread-1",
        observedFriction: "Patch timeout was not recovered.",
        conversationExcerpt: "full proposed skill body",
        status: "proposed",
        targetSkillId: "build-page",
        createdAt: dt("2026-05-15T12:10:00.000Z"),
      },
    ]);
    prismaMock.skillRevision.findMany.mockResolvedValue([
      {
        id: "revision-row-1",
        revisionId: "SREV-1",
        skillId: "build-page",
        version: 2,
        changeReason: "approved proposal IP-SKL-1",
        changedBy: "reviewer-1",
        proposalId: "IP-SKL-1",
        createdAt: dt("2026-05-15T12:15:00.000Z"),
      },
    ]);

    const results = await searchSkillEvidence({ skillId: "build-page", limit: 20 });

    expect(results.map((r) => r.kind)).toEqual([
      "skill_revision",
      "improvement_proposal",
      "tool_execution",
      "skill_usage_event",
    ]);
    expect(results[0]).toMatchObject({
      id: "SREV-1",
      label: "Skill revision v2",
      refs: { skillId: "build-page", proposalId: "IP-SKL-1" },
    });
    expect(results[2]).toMatchObject({
      id: "tool-1",
      label: "apply_patch failed",
      refs: { skillId: "build-page", threadId: "thread-1", taskRunId: "TR-1" },
    });
    expect(prismaMock.skillUsageEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ skillId: "build-page" }),
      }),
    );
  });

  it("maps public TaskRun.taskRunId to TaskRun.id before reading task messages and artifacts", async () => {
    prismaMock.taskRun.findMany.mockResolvedValue([
      {
        id: "task-row-1",
        taskRunId: "TR-123",
        title: "Repair build skill",
        objective: "Use the skill evidence to repair a failed run.",
        status: "failed",
        source: "skill",
        threadId: "thread-7",
        routeContext: "/build",
        initiatingAgentId: "AGT-BUILD",
        currentAgentId: "AGT-BUILD",
        startedAt: dt("2026-05-15T13:00:00.000Z"),
        completedAt: dt("2026-05-15T13:10:00.000Z"),
        createdAt: dt("2026-05-15T13:00:00.000Z"),
      },
    ]);
    prismaMock.taskMessage.findMany.mockResolvedValue([
      {
        id: "task-message-row-1",
        messageId: "MSG-1",
        taskRunId: "task-row-1",
        role: "agent",
        parts: [{ type: "text", text: "Recovered after operator correction." }],
        metadata: { correction: true },
        createdAt: dt("2026-05-15T13:04:00.000Z"),
      },
    ]);
    prismaMock.taskArtifact.findMany.mockResolvedValue([
      {
        id: "artifact-row-1",
        artifactId: "ART-1",
        taskRunId: "task-row-1",
        name: "verification-notes.md",
        description: "Focused verification notes",
        parts: [{ type: "text", text: "timeout reproduced" }],
        metadata: {},
        createdAt: dt("2026-05-15T13:05:00.000Z"),
      },
    ]);

    const results = await searchSkillEvidence({ taskRunId: "TR-123", limit: 10 });

    const messageCall = prismaMock.taskMessage.findMany.mock.calls[0]?.[0];
    const artifactCall = prismaMock.taskArtifact.findMany.mock.calls[0]?.[0];
    expect(messageCall.where.taskRunId.in).toContain("task-row-1");
    expect(artifactCall.where.taskRunId.in).toContain("task-row-1");
    expect(results.map((r) => r.kind)).toEqual([
      "task_artifact",
      "task_message",
      "task_run",
    ]);
    expect(results[0]).toMatchObject({
      id: "ART-1",
      refs: { taskRunId: "TR-123", taskRunRowId: "task-row-1" },
    });
  });

  it("filters collected scoped evidence by query without treating memory as evidence", async () => {
    prismaMock.skillUsageEvent.findMany.mockResolvedValue([
      {
        id: "sue-row-1",
        eventId: "SUE-1",
        skillId: "build-page",
        agentId: "AGT-BUILD",
        userId: null,
        threadId: "thread-1",
        taskRunId: null,
        toolExecutionId: null,
        routeContext: "/build",
        phase: "failed",
        source: "coworker",
        metadata: { reason: "operator correction after timeout" },
        createdAt: dt("2026-05-15T12:00:00.000Z"),
      },
      {
        id: "sue-row-2",
        eventId: "SUE-2",
        skillId: "build-page",
        agentId: "AGT-BUILD",
        userId: null,
        threadId: "thread-2",
        taskRunId: null,
        toolExecutionId: null,
        routeContext: "/build",
        phase: "completed",
        source: "coworker",
        metadata: { reason: "normal completion" },
        createdAt: dt("2026-05-15T12:01:00.000Z"),
      },
    ]);

    const results = await searchSkillEvidence({
      skillId: "build-page",
      query: "operator correction",
      limit: 10,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      kind: "skill_usage_event",
      id: "SUE-1",
    });
    expect(results[0]?.summary).toContain("operator correction");
  });

  it("requires an explicit evidence scope", async () => {
    await expect(searchSkillEvidence({ query: "timeout" })).rejects.toThrow(
      /requires skillId, threadId, taskRunId, or routeContext/,
    );
  });

  it("does not fetch global skill proposals for task-run-only evidence searches", async () => {
    await searchSkillEvidence({ taskRunId: "TR-DOES-NOT-LINK-PROPOSALS", limit: 10 });

    expect(prismaMock.improvementProposal.findMany).not.toHaveBeenCalled();
  });
});

describe("summarizeSkillEvidenceForPrompt", () => {
  it("renders bounded prompt context from evidence results", () => {
    const summary = summarizeSkillEvidenceForPrompt(
      [
        {
          kind: "tool_execution",
          id: "tool-1",
          label: "apply_patch failed",
          summary: "Patch failed after timeout while applying skill guidance.",
          createdAt: "2026-05-15T12:05:00.000Z",
          refs: {
            skillId: "build-page",
            threadId: "thread-1",
            taskRunId: "TR-1",
          },
        },
        {
          kind: "skill_usage_event",
          id: "SUE-1",
          label: "Skill build-page failed",
          summary: "metadata: operator correction after timeout",
          createdAt: "2026-05-15T12:00:00.000Z",
          refs: {
            skillId: "build-page",
            threadId: "thread-1",
          },
        },
      ],
      140,
    );

    expect(summary).toContain("tool_execution");
    expect(summary).toContain("apply_patch failed");
    expect(summary.length).toBeLessThanOrEqual(140);
  });
});
