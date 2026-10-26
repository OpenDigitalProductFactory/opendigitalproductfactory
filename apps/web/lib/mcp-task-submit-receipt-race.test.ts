import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), outcome: vi.fn(), execute: vi.fn(), create: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { taskRun: { findFirst: mocks.find, updateMany: mocks.update } } }));
vi.mock("./mcp-task-review-outcome", async (original) => ({
  ...await original<typeof import("./mcp-task-review-outcome")>(), loadTaskInitiativeReviewOutcome: mocks.outcome,
}));
vi.mock("@/lib/tak/autonomous-work-run", () => ({
  executeAutonomousAgenticLoop: mocks.execute, createAutonomousWorkRun: mocks.create,
  executeAutonomousWorkTool: vi.fn(), resolveAutonomousWorkAgent: vi.fn(), resolveAutonomousWorkTools: vi.fn(),
}));
import { submitRemoteCoworkerTask } from "./mcp-task-submit";
import { persistedReviewCompletionData } from "./mcp-task-review-outcome";
import { parseRemoteTaskSubmitParams } from "./mcp-task-submit-params";
import { remoteTaskRequestDigest } from "./mcp-task-capacity-contract";

beforeEach(() => vi.resetAllMocks());

it("a receipt CAS loser reads the winner's completed task without a live uncertainty hold or another execution", async () => {
  const artifactRef = { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: "a".repeat(40),
    providerBlobId: "b".repeat(40), path: "docs/superpowers/specs/fixture.md" };
  const params = { agentId: "AGT-WS-REVIEW", routeContext: "/build", title: "Review exact source",
    objective: "Review the original artifact", prompt: "Review the original artifact", idempotencyKey: "original-review-race",
    riskClass: "bounded-write", collaborationKind: "handoff",
    authorityScope: ["backlog-item:BI-TEST", "tool:read_source_at_version", "tool:record_initiative_design_review"],
    initiativeReviewBinding: { writerToolName: "record_initiative_design_review", itemId: "BI-TEST", gate: "design-spec", artifactRef } };
  const parsed = parseRemoteTaskSubmitParams(params);
  if (typeof parsed === "string") throw new Error(parsed);
  const uncertainty = { schemaVersion: 1, kind: "execution-uncertain", settlement: "unknown" };
  const original = { id: "original-row", taskRunId: "TR-ORIGINAL", userId: "user-1", status: "input-required",
    updatedAt: new Date("2026-10-15T22:15:48.811Z"), progressPayload: { executionUncertainty: uncertainty },
    a2aMetadata: { apiTokenId: "PAT", requestDigestVersion: 2, requestDigest: remoteTaskRequestDigest(parsed) } };
  const outcome = { receiptId: "original-receipt", gate: "design-spec", decision: "pass", artifactRef,
    summary: "Exact persisted receipt verified.", readiness: {} };
  const completed = persistedReviewCompletionData(original.progressPayload, outcome as never);
  const winner = { ...original, ...completed };
  mocks.find.mockResolvedValueOnce(original).mockResolvedValueOnce(winner);
  mocks.outcome.mockResolvedValue(outcome);
  mocks.update.mockResolvedValue({ count: 0 });

  const result = await submitRemoteCoworkerTask({ token: { tokenId: "PAT", userId: "user-1", capability: "write", source: "pat" },
    userContext: { platformRole: "developer", isSuperuser: false }, params });

  expect(result).toMatchObject({ kind: "result", result: { taskRunId: original.taskRunId,
    status: "completed", idempotentReplay: true, requiresApproval: false } });
  if (result.kind !== "result") throw new Error("Expected task replay");
  expect(result.result.waitReason).toBeUndefined();
  expect(result.result.progressPayload).toMatchObject({ reviewOutcome: { receiptId: "original-receipt" },
    executionUncertaintyResolution: { prior: { executionUncertainty: uncertainty } } });
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: {
    taskRunId: original.taskRunId, status: original.status, updatedAt: original.updatedAt } }));
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(original.progressPayload.executionUncertainty.settlement).toBe("unknown");
});
