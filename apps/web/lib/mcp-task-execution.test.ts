import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findModelConfig: vi.fn(),
  findTaskRun: vi.fn(),
  updateTaskRun: vi.fn(),
}));
const autonomous = vi.hoisted(() => ({
  execute: vi.fn(),
  resolveAgent: vi.fn(),
  resolveTools: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    agentModelConfig: { findUnique: (...args: unknown[]) => db.findModelConfig(...args) },
    taskRun: {
      findUnique: (...args: unknown[]) => db.findTaskRun(...args),
      update: (...args: unknown[]) => db.updateTaskRun(...args),
    },
  },
}));
vi.mock("@/lib/tak/autonomous-work-run", () => ({
  executeAutonomousAgenticLoop: (...args: unknown[]) => autonomous.execute(...args),
  resolveAutonomousWorkAgent: (...args: unknown[]) => autonomous.resolveAgent(...args),
  resolveAutonomousWorkTools: (...args: unknown[]) => autonomous.resolveTools(...args),
}));
vi.mock("@/lib/tak/task-records", () => ({ createTaskMessage: vi.fn() }));

import { executeRemoteTaskAttempt } from "./mcp-task-execution";

const writerToolName = "record_initiative_evidence";
const parsed = {
  agentId: "AGT-WS-PORTFOLIO",
  routeContext: "/platform/build",
  title: "Independent research review",
  objective: "Review the immutable artifact.",
  prompt: "Read the source and record the governed evidence.",
  idempotencyKey: "initiative-readiness:BI-FFBDDD96:research:current-head-1",
  riskClass: "bounded-write" as const,
  authorityScope: [
    "backlog-item:BI-FFBDDD96",
    "tool:read_source_at_version",
    `tool:${writerToolName}`,
  ],
  collaborationKind: "handoff" as const,
  initiativeReviewBinding: {
    writerToolName,
    itemId: "BI-FFBDDD96",
    gate: "research" as const,
    artifactRef: {
      kind: "repo-blob-at-commit" as const,
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      commitSha: "0db795572b944370fa132b8c4ab11c759cc63bb1",
      path: "docs/superpowers/specs/2026-06-06-procedural-functional-verification-design.md",
      providerBlobId: "951fe02f7aa19a6a0866d42620c83bb8d3d9d8cd",
    },
  },
};

describe("remote task terminal-writer postcondition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.findModelConfig.mockResolvedValue(null);
    db.findTaskRun.mockResolvedValue({ status: "working" });
    db.updateTaskRun.mockResolvedValue({});
    autonomous.resolveAgent.mockResolvedValue({
      agentId: "AGT-WS-PORTFOLIO",
      displayName: "Portfolio Advisor",
      systemPrompt: "Review independently.",
      sensitivity: "internal",
    });
    autonomous.resolveTools.mockResolvedValue({ tools: [], toolsForProvider: [], deferredTools: [] });
  });

  it("parks a duration exit after a failed read retry when the required writer is absent", async () => {
    autonomous.execute.mockResolvedValue({
      content: "The first read failed due to a malformed version string in my call. Retrying with clean, exactly-bound parameters.",
      executedTools: [
        { name: "read_source_at_version", result: { success: false } },
        { name: "read_source_at_version", result: { success: true } },
      ],
    });

    const outcome = await executeRemoteTaskAttempt({
      run: { id: "run-internal", taskRunId: "TR-MCP-7991D9CAE467", contextId: "thread-1" },
      threadId: "thread-1",
      token: { tokenId: "PAT-WRITER-DURATION", userId: "user-1", capability: "write", source: "pat" },
      userContext: { platformRole: "developer", isSuperuser: false },
      parsed,
      idempotentReplay: false,
      capacityAttempt: 1,
    });

    expect(db.updateTaskRun).toHaveBeenCalledWith({
      where: { taskRunId: "TR-MCP-7991D9CAE467" },
      data: expect.objectContaining({
        status: "input-required",
        completedAt: null,
        progressPayload: expect.objectContaining({
          executedToolCount: 2,
          terminalWriterWait: expect.objectContaining({
            kind: "missing-terminal-writer",
            writerToolName,
            resumeMode: "same-taskrun",
            attempt: 1,
          }),
        }),
      }),
    });
    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        status: "input-required",
        resumable: true,
        waitReason: "missing-terminal-writer",
        executedToolCount: 2,
      },
    });
  });
});
