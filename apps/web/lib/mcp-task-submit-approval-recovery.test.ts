import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fingerprintCoworkerApprovalBinding,
  type CoworkerApprovalBinding,
} from "@/lib/govern/authority/coworker-authority-decision";

const db = vi.hoisted(() => ({
  findFirst: vi.fn(), findUnique: vi.fn(), findModelConfig: vi.fn(),
  findEnvelope: vi.fn(), findToolExecution: vi.fn(), createEnvelope: vi.fn(),
  updateEnvelopes: vi.fn(), createToolExecution: vi.fn(), transaction: vi.fn(),
  update: vi.fn(), updateMany: vi.fn(), upsertThread: vi.fn(),
}));
const autonomous = vi.hoisted(() => ({
  create: vi.fn(), execute: vi.fn(), executeTool: vi.fn(),
  resolveAgent: vi.fn(), resolveTools: vi.fn(),
}));

vi.mock("@dpf/db", () => {
  const prisma = {
    taskRun: {
      findFirst: (...args: unknown[]) => db.findFirst(...args),
      findUnique: (...args: unknown[]) => db.findUnique(...args),
      update: (...args: unknown[]) => db.update(...args),
      updateMany: (...args: unknown[]) => db.updateMany(...args),
    },
    coworkerActionEnvelope: {
      findFirst: (...args: unknown[]) => db.findEnvelope(...args),
      create: (...args: unknown[]) => db.createEnvelope(...args),
      updateMany: (...args: unknown[]) => db.updateEnvelopes(...args),
    },
    toolExecution: {
      findFirst: (...args: unknown[]) => db.findToolExecution(...args),
      create: (...args: unknown[]) => db.createToolExecution(...args),
    },
    agentThread: { upsert: (...args: unknown[]) => db.upsertThread(...args) },
    agentModelConfig: { findUnique: (...args: unknown[]) => db.findModelConfig(...args) },
    $transaction: (callback: (tx: unknown) => unknown) => db.transaction(callback, prisma),
  };
  return { prisma };
});
vi.mock("@/lib/tak/autonomous-work-run", () => ({
  createAutonomousWorkRun: (...args: unknown[]) => autonomous.create(...args),
  executeAutonomousAgenticLoop: (...args: unknown[]) => autonomous.execute(...args),
  executeAutonomousWorkTool: (...args: unknown[]) => autonomous.executeTool(...args),
  resolveAutonomousWorkAgent: (...args: unknown[]) => autonomous.resolveAgent(...args),
  resolveAutonomousWorkTools: (...args: unknown[]) => autonomous.resolveTools(...args),
}));
vi.mock("@/lib/tak/task-records", () => ({ createTaskMessage: vi.fn() }));

import { submitRemoteCoworkerTask } from "./mcp-task-submit";

beforeEach(() => {
  vi.clearAllMocks();
  db.createEnvelope.mockResolvedValue({ id: "ENV-REPLACEMENT" });
  db.updateEnvelopes.mockResolvedValue({ count: 1 });
  db.createToolExecution.mockResolvedValue({ id: "tool-proposal-new" });
  db.updateMany.mockResolvedValue({ count: 1 });
  db.transaction.mockImplementation(async (callback: (tx: unknown) => unknown, tx: unknown) => callback(tx));
  db.findModelConfig.mockResolvedValue({ minimumTier: "strong", budgetClass: "quality_first" });
});

describe("submitRemoteCoworkerTask approval recovery", () => {
  it("recovers the same stalled review TaskRun into fresh exact approval without rerunning inference", async () => {
    const params = {
      agentId: "AGT-WS-PORTFOLIO",
      routeContext: "/build",
      title: "Review BI-47",
      objective: "Review the immutable BI-47 artifact.",
      prompt: "Read the immutable artifact and record the assessment.",
      idempotencyKey: "initiative-readiness:BI-47:material-runtime-1",
      riskClass: "bounded-write" as const,
      authorityScope: ["backlog-item:BI-47ACE2C7", "tool:read_source_at_version", "tool:record_initiative_evidence"],
      initiativeReviewBinding: {
        writerToolName: "record_initiative_evidence",
        itemId: "BI-47ACE2C7",
        gate: "research" as const,
        artifactRef: {
          kind: "repo-blob-at-commit" as const,
          repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
          commitSha: "2e9f97d2d5ccb5f97b60e0991c34820a83cc1ec0",
          path: "docs/superpowers/specs/2026-08-26-external-reviewer-organization-authority-design.md",
          providerBlobId: "5ac674c03be1b21a335ea5b8607125f830e673a5",
        },
      },
    };
    const requestDigest = createHash("sha256").update(JSON.stringify({
      agentId: params.agentId, routeContext: params.routeContext, title: params.title,
      objective: params.objective, prompt: params.prompt, riskClass: params.riskClass,
      authorityScope: [...params.authorityScope].sort(), collaborationKind: null,
      initiativeReviewBinding: params.initiativeReviewBinding,
    })).digest("hex");
    const approvalBinding: CoworkerApprovalBinding = {
      actingHumanUserId: "user-1", actingAgentId: params.agentId, chainId: null,
      taskRunId: "TR-MCP-BI47-96433C11CA61", toolName: "record_initiative_evidence",
      subject: { kind: "backlog-item", id: "BI-47ACE2C7" }, routeContext: "/build",
      inputFingerprint: "1bf298b6f4641c8700535c9bc6c73613a2a88708343fab39cb97c62e848133b1",
      sensitivity: "internal",
      decisionVersionFingerprint: "54c71d9f3f5a71a93660a11ef6888bbb66540b2815e14a95f0f1f59e06a94e49",
    };
    const run = {
      id: "task-internal", taskRunId: approvalBinding.taskRunId, userId: "user-1",
      threadId: "thread-bi47", contextId: "thread-bi47", status: "stalled",
      progressPayload: null,
      a2aMetadata: { idempotencyKey: params.idempotencyKey, apiTokenId: "PAT-BI47", requestDigest },
      lastHeartbeatAt: new Date(Date.now() - 20 * 60 * 1000),
      completedAt: new Date(Date.now() - 19 * 60 * 1000),
      updatedAt: new Date(Date.now() - 19 * 60 * 1000),
    };
    db.findFirst.mockResolvedValue(run);
    db.findUnique.mockResolvedValue(run);
    db.findEnvelope.mockResolvedValue({
      id: "ENV-EXPIRED", coworkerAgentId: params.agentId, delegatingUserId: "user-1",
      threadId: "thread-bi47", chatMessageId: null, manifestActionId: approvalBinding.toolName,
      argsJson: { approvalBinding }, rationale: "Approval is required.", status: "approved",
      taskRunId: approvalBinding.taskRunId, delegationChainId: null,
      authorityDecisionId: "AUTH-BI47", inputFingerprint: approvalBinding.inputFingerprint,
      approvalBindingFingerprint: fingerprintCoworkerApprovalBinding(approvalBinding),
      expiresAt: new Date(Date.now() - 60_000),
    });
    db.findToolExecution.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "tool-proposal-old", threadId: "thread-bi47", agentId: params.agentId,
      userId: "user-1", toolName: approvalBinding.toolName,
      parameters: { decision: "pass", backlogItemId: "BI-47ACE2C7" },
      result: { data: { envelopeId: "ENV-EXPIRED" } }, success: false,
      executionMode: "proposal", routeContext: "/build", auditClass: "governed",
      capabilityId: null, summary: "Approval required", apiTokenId: "PAT-BI47",
      taskRunId: approvalBinding.taskRunId, skillId: null, delegatingUserId: "user-1",
      chatMessageId: null, envelopeId: null, delegationChainId: null,
    });

    const outcome = await submitRemoteCoworkerTask({
      token: { tokenId: "PAT-BI47", userId: "user-1", capability: "write", source: "pat" },
      userContext: { platformRole: "developer", isSuperuser: false }, params,
    });

    expect(outcome).toMatchObject({ kind: "result", result: {
      taskRunId: approvalBinding.taskRunId, status: "input-required",
      idempotentReplay: true, resumedFromApprovalRecovery: true, requiresApproval: true,
      replacementEnvelopeId: "ENV-REPLACEMENT", structuredContent: {
        recovery: "expired-approved-envelope", sourceEnvelopeId: "ENV-EXPIRED",
        replacementProposalExecutionId: "tool-proposal-new", inferenceRerun: false,
      },
    } });
    expect(autonomous.execute).not.toHaveBeenCalled();
    expect(autonomous.create).not.toHaveBeenCalled();
    expect(autonomous.executeTool).not.toHaveBeenCalled();
  });
});
