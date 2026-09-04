import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findTaskRun: vi.fn(),
  findCurrentTaskRun: vi.fn(),
  findEnvelope: vi.fn(),
  findToolExecution: vi.fn(),
  updateTaskRun: vi.fn(),
  reserveTaskRun: vi.fn(),
}));
const autonomous = vi.hoisted(() => ({ executeTool: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: {
      findFirst: (...args: unknown[]) => db.findTaskRun(...args),
      findUnique: (...args: unknown[]) => db.findCurrentTaskRun(...args),
      update: (...args: unknown[]) => db.updateTaskRun(...args),
      updateMany: (...args: unknown[]) => db.reserveTaskRun(...args),
    },
    coworkerActionEnvelope: {
      findFirst: (...args: unknown[]) => db.findEnvelope(...args),
    },
    toolExecution: {
      findFirst: (...args: unknown[]) => db.findToolExecution(...args),
    },
  },
}));
vi.mock("@/lib/tak/autonomous-work-run", () => ({
  executeAutonomousWorkTool: (...args: unknown[]) => autonomous.executeTool(...args),
}));

import { submitRemoteCoworkerTask } from "./mcp-task-submit";

it("consumes an approved exact-bound writer from a historically completed TaskRun", async () => {
  const taskRunId = "TR-MCP-OBJECTIVE-MAPPING";
  const params = {
    agentId: "AGT-WS-BUILD",
    routeContext: "/build/work/WC-923105A2",
    title: "Objective mapping for BI-BFBF1BBB",
    objective: "Record the exact objective mapping.",
    prompt: "Read the bound design and record the objective mapping.",
    idempotencyKey: "initiative-readiness:BI-BFBF1BBB:objective-mapping:head",
    riskClass: "bounded-write" as const,
    authorityScope: [
      "backlog-item:BI-BFBF1BBB",
      "tool:read_source_at_version",
      "tool:record_initiative_evidence",
    ],
    initiativeReviewBinding: {
      writerToolName: "record_initiative_evidence",
      itemId: "BI-BFBF1BBB",
      gate: "objective-mapping" as const,
      expectedCurrentBaselineId: "baseline-bi-bfbf1bbb",
      artifactRef: {
        kind: "repo-blob-at-commit" as const,
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        commitSha: "0fbf03cc4794b89dcd845bc6a867df6fed311bad",
        path: "docs/superpowers/specs/2026-07-06-bi-work-location-claim-at-start-design.md",
        providerBlobId: "5e71fb539b174a583ad2f480cebc1a7146d69dd7",
      },
    },
  };
  const requestDigest = createHash("sha256").update(JSON.stringify({
    agentId: params.agentId,
    routeContext: params.routeContext,
    title: params.title,
    objective: params.objective,
    prompt: params.prompt,
    riskClass: params.riskClass,
    authorityScope: [...params.authorityScope].sort(),
    collaborationKind: null,
    initiativeReviewBinding: params.initiativeReviewBinding,
  })).digest("hex");
  const updatedAt = new Date("2026-09-03T23:00:00.000Z");
  db.findTaskRun.mockResolvedValue({
    id: "task-internal",
    taskRunId,
    userId: "user-1",
    threadId: "thread-objective-mapping",
    contextId: "thread-objective-mapping",
    status: "completed",
    progressPayload: { summary: "Approval required.", requiresApproval: true },
    a2aMetadata: { requestDigest, idempotencyKey: params.idempotencyKey, apiTokenId: "PAT-A" },
    lastHeartbeatAt: updatedAt,
    completedAt: updatedAt,
    updatedAt,
  });
  db.findEnvelope.mockResolvedValue({
    id: "ENV-OBJECTIVE-MAPPING",
    threadId: "thread-objective-mapping",
    manifestActionId: "record_initiative_evidence",
  });
  db.findToolExecution.mockResolvedValue({
    parameters: {
      backlogItemId: "BI-BFBF1BBB",
      operation: "objective-mapping",
      decision: "pass",
      _takAlignment: { verdict: "aligned" },
    },
  });
  db.reserveTaskRun.mockResolvedValue({ count: 1 });
  db.updateTaskRun.mockResolvedValue({});
  db.findCurrentTaskRun.mockResolvedValue({ status: "working" });
  autonomous.executeTool.mockResolvedValue({
    success: true,
    message: "Objective mapping recorded.",
    entityId: "initiative-mapping-receipt",
  });

  const outcome = await submitRemoteCoworkerTask({
    token: { tokenId: "PAT-A", userId: "user-1", capability: "write", source: "pat" },
    userContext: { platformRole: "developer", isSuperuser: false },
    params,
  });

  expect(db.reserveTaskRun).toHaveBeenCalledWith({
    where: { taskRunId, status: "completed", updatedAt },
    data: {
      completedAt: null,
      progressPayload: expect.objectContaining({ approvalResumeReserved: true }),
    },
  });
  expect(autonomous.executeTool).toHaveBeenCalledWith(expect.objectContaining({
    toolName: "record_initiative_evidence",
    taskRunId,
    args: {
      backlogItemId: "BI-BFBF1BBB",
      operation: "objective-mapping",
      decision: "pass",
    },
  }));
  expect(outcome).toMatchObject({
    kind: "result",
    result: {
      taskRunId,
      status: "completed",
      idempotentReplay: true,
      resumedFromApproval: true,
      entityId: "initiative-mapping-receipt",
    },
  });
});
