import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ task: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { taskRun: { findUnique: db.task } } }));
import { _setGovernanceForTests, governedExecuteTool } from "./mcp-governed-execute";
import * as authority from "./govern/authority/coworker-tool-authority-gate";
const reviewBinding = { itemId: "BI-TEST", gate: "research", writerToolName: "record_initiative_evidence",
  artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "org/repo", commitSha: "a".repeat(40),
    path: "docs/design.md", providerBlobId: "b".repeat(40) } };

beforeEach(() => db.task.mockResolvedValue({ a2aMetadata: {}, progressPayload: {} }));
afterEach(() => { _setGovernanceForTests({ executeTool: null, toolExecutionCreate: null }); vi.restoreAllMocks(); });

describe("trusted execution identity forwarding", () => {
  it("rechecks a bound callback when a hold wins after entry validation", async () => {
    const requestDigest = "9".repeat(64);
    const taskExecutionFence = { schemaVersion: 1 as const, reservation: null, dispatchClaim: null, authorityDigest: null, requestDigest };
    const current = { userId: "user", currentAgentId: "reviewer", status: "working",
      a2aMetadata: { initiativeReviewBinding: reviewBinding, requestDigest }, progressPayload: {} };
    db.task.mockResolvedValueOnce(current).mockResolvedValue({ ...current, status: "input-required" });
    vi.spyOn(authority, "enforceCoworkerToolAuthority").mockResolvedValue({ outcome: "allow", approvedEnvelopeId: null, reservedAt: null, authorityDecisionId: "fixture" });
    const execute = vi.fn(async () => ({ success: true, message: "Effect" }));
    _setGovernanceForTests({ executeTool: execute, toolExecutionCreate: vi.fn(async () => ({ id: "audit" })),
      resolveAgentGrants: async () => ["backlog_read"], isAllowedByGrants: () => true });
    const result = await governedExecuteTool({ toolName: "query_backlog", rawParams: {}, userId: "user",
      userContext: { platformRole: "ceo", isSuperuser: true }, source: "rest",
      context: { taskRunId: "task", agentId: "reviewer", taskExecutionFence } });
    expect(result).toMatchObject({ success: false, error: "review_execution_authority_refused" });
    expect(db.task).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
  });
  it("refuses a legacy held review at the real dispatch guard without trusting a callback's current identity", async () => {
    db.task.mockResolvedValue({ userId: "user", currentAgentId: "reviewer", status: "input-required",
      a2aMetadata: { initiativeReviewBinding: reviewBinding, requestDigest: "9".repeat(64) }, progressPayload: { executionUncertainty: {} } });
    const execute = vi.fn();
    _setGovernanceForTests({ executeTool: execute, toolExecutionCreate: vi.fn(async () => ({ id: "audit" })) });
    const result = await governedExecuteTool({ toolName: "query_backlog", rawParams: {}, userId: "user",
      userContext: { platformRole: "ceo", isSuperuser: true }, source: "rest", context: { taskRunId: "task" } });
    expect(result).toMatchObject({ success: false, error: "review_execution_authority_refused" });
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([true, false])("forwards only server context when captured=%s", async (captured) => {
    const taskExecutionFence = { schemaVersion: 1 as const, reservation: "admitted", dispatchClaim: "dispatch", authorityDigest: null, requestDigest: "9".repeat(64) };
    const execute = vi.fn(async (_name: string, _params: unknown, _userId: string, _context: unknown) => ({ success: true, message: "Read completed." }));
    _setGovernanceForTests({ executeTool: execute as never,
      toolExecutionCreate: vi.fn(async () => ({ id: "audit" })) as never });
    await governedExecuteTool({ toolName: "query_backlog", rawParams: { taskExecutionFence: { ...taskExecutionFence, reservation: "forged" } },
      userId: "user", userContext: { platformRole: "ceo", isSuperuser: true }, source: "rest",
      context: { taskRunId: "task", ...(captured ? { taskExecutionFence } : {}) } });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[3]).toMatchObject({ taskRunId: "task" });
    expect((execute.mock.calls[0]?.[3] as Record<string, unknown>)?.taskExecutionFence).toEqual(captured ? taskExecutionFence : undefined);
  });
});
