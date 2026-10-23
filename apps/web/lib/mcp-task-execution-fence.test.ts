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
const pirContext = vi.hoisted(() => vi.fn(async () => ""));
const sensitivity = vi.hoisted(() => vi.fn(async (_parsed: unknown, _token: unknown, fallback: string) => fallback));
vi.mock("./mcp-task-review-sensitivity", () => ({ remoteReviewSensitivity: sensitivity }));
vi.mock("./pir-evidence-context", () => ({ loadPirEvidenceContext: pirContext }));
vi.mock("./mcp-task-review-outcome", async (importOriginal) => ({
  ...await importOriginal<typeof import("./mcp-task-review-outcome")>(),
  // BI-2E479619: the executor consults the TaskRun's persisted receipt before classifying a missing writer.
  loadTaskInitiativeReviewOutcome: vi.fn(async () => null),
  loadInitiativeReviewOutcome: vi.fn(async (_binding: unknown, receiptId: string) => ({
    receiptId, summary: `Receipt ${receiptId} persisted. Implementation readiness: input-required; plan coverage remains missing.`,
  })),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    agentModelConfig: { findUnique: (...args: unknown[]) => db.findModelConfig(...args) },
    taskRun: {
      findUnique: (...args: unknown[]) => db.findTaskRun(...args),
      update: (...args: unknown[]) => db.updateTaskRun(...args),
      updateMany: (...args: unknown[]) => db.updateTaskRun(...args),
    },
  },
}));
vi.mock("@/lib/tak/autonomous-work-run", () => ({
  executeAutonomousAgenticLoop: (...args: unknown[]) => autonomous.execute(...args),
  resolveAutonomousWorkAgent: (...args: unknown[]) => autonomous.resolveAgent(...args),
  resolveAutonomousWorkTools: (...args: unknown[]) => autonomous.resolveTools(...args),
}));
vi.mock("@/lib/tak/task-records", () => ({ createTaskMessage: vi.fn() }));
vi.mock("./mcp/external-approval-location-lookup", () => ({
  withTaskRunApprovalLocation: vi.fn(async (value: unknown) => value),
}));

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

beforeEach(() => {
  vi.clearAllMocks();
  db.findModelConfig.mockResolvedValue(null);
  db.updateTaskRun.mockResolvedValue({ count: 1 });
  autonomous.resolveAgent.mockResolvedValue({ agentId: parsed.agentId, systemPrompt: "Review independently.", sensitivity: "internal" });
});
describe("admitted review execution fence", () => {
  it("captures the admitted request and generation before asynchronous tool preparation", async () => {
    const admitted = { status: "working", progressPayload: { resumeReservedAt: "original", dispatch: { claimedAt: "original-dispatch" } },
      a2aMetadata: { requestDigest: "9".repeat(64) } };
    db.findTaskRun.mockResolvedValue(admitted);
    autonomous.resolveTools.mockImplementationOnce(async () => {
      admitted.progressPayload.resumeReservedAt = "later";
      admitted.progressPayload.dispatch.claimedAt = "later-dispatch";
      admitted.a2aMetadata.requestDigest = "8".repeat(64);
      return { tools: [], toolsForProvider: [], deferredTools: [] };
    });
    autonomous.execute.mockResolvedValue({ content: "Reviewing.", executedTools: [] });
    await executeRemoteTaskAttempt({ run: { id: "original", taskRunId: "TR-ORIGINAL", contextId: "thread-1" }, threadId: "thread-1",
      token: { tokenId: "oauth", userId: "human", capability: "write", source: "oauth" }, userContext: {} as never,
      parsed, idempotentReplay: false, capacityAttempt: 1, expectedReservation: "original", expectedDispatchClaim: "original-dispatch" });
    expect(autonomous.execute).toHaveBeenCalledWith(expect.objectContaining({ taskExecutionFence: {
      schemaVersion: 1, reservation: "original", dispatchClaim: "original-dispatch", authorityDigest: null, requestDigest: "9".repeat(64),
    } }));
  });
});
