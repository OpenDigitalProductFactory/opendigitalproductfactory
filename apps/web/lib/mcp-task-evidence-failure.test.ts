import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ read: vi.fn(), settle: vi.fn(), execute: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { taskRun: {
  findUnique: db.read, updateMany: db.settle, update: db.settle,
}, agentModelConfig: { findUnique: vi.fn(async () => null) } } }));
vi.mock("./tak/autonomous-work-run", () => ({
  executeAutonomousAgenticLoop: db.execute,
  resolveAutonomousWorkAgent: vi.fn(async () => ({ agentId: "coo", systemPrompt: "Read live records.", sensitivity: "internal" })),
  resolveAutonomousWorkTools: vi.fn(async () => ({ tools: [], toolsForProvider: [], deferredTools: [] })),
}));
vi.mock("./tak/task-records", () => ({ createTaskMessage: vi.fn() }));
vi.mock("./mcp-task-review-outcome", async original => ({
  ...await original<typeof import("./mcp-task-review-outcome")>(), loadTaskInitiativeReviewOutcome: vi.fn(async () => null),
}));
import { executeRemoteTaskAttempt } from "./mcp-task-execution";

beforeEach(() => {
  vi.clearAllMocks();
  db.read.mockResolvedValue({ status: "working", progressPayload: {}, a2aMetadata: {}, userId: "human", currentAgentId: "coo" });
  db.settle.mockResolvedValue({ count: 1 });
});

it("reports exhausted evidence recovery as failed, without returning or publishing the withheld draft", async () => {
  db.execute.mockResolvedValue({ content: "The request is unfinished.", executedTools: [],
    withheldContent: "UNVERIFIED_PRIVATE_DRAFT", failure: { kind: "evidence-unavailable", message: "The request is unfinished." } });
  const outcome = await executeRemoteTaskAttempt({ run: { id: "task-row", taskRunId: "TR-EVIDENCE-FAILURE", contextId: "thread-1" },
    threadId: "thread-1", token: { tokenId: "token", userId: "human", capability: "write", source: "pat" },
    userContext: { platformRole: "developer", isSuperuser: false }, parsed: {
      agentId: "coo", routeContext: "/workspace/inbox", title: "Read approvals", objective: "Count own requests.",
      prompt: "Read pending approvals.", idempotencyKey: "fixture-evidence-failure", riskClass: "read", authorityScope: [],
      collaborationKind: "handoff",
    }, idempotentReplay: false, capacityAttempt: 1 });
  expect(outcome).toMatchObject({ kind: "result", result: { status: "failed", isError: true, resumable: false } });
  expect(db.settle).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }));
  expect(JSON.stringify(outcome)).not.toContain("UNVERIFIED_PRIVATE_DRAFT");
  expect(JSON.stringify(db.settle.mock.calls)).not.toContain("UNVERIFIED_PRIVATE_DRAFT");
});
