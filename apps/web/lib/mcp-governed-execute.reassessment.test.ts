import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reassessmentBudgetFixture } from "../test-support/reassessment-budget-fixture";
vi.mock("@dpf/db", () => ({ prisma: { taskRun: { findUnique: vi.fn(async () => ({
  taskRunId: "TR-FIXTURE", userId: "user", a2aMetadata: {}, parentTaskRunId: null,
})) } } }));
vi.mock("./mcp-task-review-recovery", () => ({ reviewRecoveryToolRefusal: vi.fn(async () => null) }));
import { _setGovernanceForTests, governedExecuteTool } from "./mcp-governed-execute";
import * as authority from "./govern/authority/coworker-tool-authority-gate";
import { runReassessmentExecution, type ReassessmentExecutionSeed, type ReassessmentCaptureHooks } from "./routing/reassessment-execution-scope";

function fixture() {
  const startedAt = new Date().toISOString();
  const seed: ReassessmentExecutionSeed = {
    schemaVersion: 1, taskRunId: "TR-FIXTURE", userId: "user", agentId: "reviewer", requestDigest: "a".repeat(64),
    executionFence: { schemaVersion: 1, reservation: null, dispatchClaim: null, authorityDigest: null, requestDigest: "a".repeat(64) },
    binding: { itemId: "BI-FIXTURE", gate: "design-spec", writerToolName: "record_initiative_design_review",
      expectedCurrentBaselineId: null, artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "fixture/repo",
        commitSha: "c".repeat(40), path: "design.md", providerBlobId: "d".repeat(40) } },
    qualification: { schemaVersion: 1, compositionVersion: "restricted-review-http-v1", providerId: "local",
      providerConnectionId: "fixture", providerConnectionVersion: "v1", modelId: "fixture", qualificationDigest: "1".repeat(64),
      providerConfigurationDigest: "e".repeat(64), toolSurfaceDigest: "f".repeat(64),
      executionPlan: { providerId: "local", modelId: "fixture", recipeId: null, contractFamily: "review", executionAdapter: "chat",
        maxTokens: 100, providerSettings: {}, toolPolicy: {}, responsePolicy: {} },
      budgetConfiguration: reassessmentBudgetFixture(),
      bounds: { maxProviderStarts: 2, maxDurationMs: 30_000, maxOutputTokens: 100 } },
    startedAt, deadlineAt: new Date(Date.parse(startedAt) + 30_000).toISOString(), manifest: { artifactId: "fixture-manifest", digest: "3".repeat(64) },
  };
  const hooks: ReassessmentCaptureHooks = { open: vi.fn(async () => {}),
    reserve: vi.fn(async (_context, event) => ({ reservationId: `fixture-${event.sequence}` })),
    complete: vi.fn(async () => {}), uncertain: vi.fn(async () => {}) };
  return { seed, hooks };
}
const execute = vi.fn(async (name: string, _params: Record<string, unknown>) => ({ success: true, message: "Fixture result.", data: { name } }));
beforeEach(() => {
  execute.mockClear();
  vi.spyOn(authority, "enforceCoworkerToolAuthority").mockResolvedValue({ outcome: "allow", approvedEnvelopeId: null, reservedAt: null, authorityDecisionId: "fixture" });
  _setGovernanceForTests({ executeTool: execute, resolveAgentGrants: async () => ["backlog_read", "initiative_design_review"],
    isAllowedByGrants: () => true, toolPreflight: async () => null,
    toolExecutionCreate: async () => ({ id: "audit" }), toolExecutionUpdate: async () => ({}),
    toolExecutionReceiptCreate: async () => ({ id: "receipt" }), toolExecutionReceiptUpdate: async () => ({}) });
});
afterEach(() => { _setGovernanceForTests({}); vi.restoreAllMocks(); });

describe("restricted scope at the production governed dispatch", () => {
  const args = (seed: ReassessmentExecutionSeed, toolName: string, rawParams: Record<string, unknown>) => ({
    toolName, rawParams, userId: seed.userId, userContext: { platformRole: "ceo", isSuperuser: true }, source: "agentic-loop" as const,
    context: { agentId: seed.agentId, taskRunId: seed.taskRunId, taskExecutionFence: seed.executionFence },
  });
  it("refuses an auxiliary tool before lookup, reservation or execution", async () => {
    const { seed, hooks } = fixture();
    await runReassessmentExecution(seed, hooks, async () => {
      await expect(governedExecuteTool(args(seed, "load_tools", { names: ["run_shell"] }))).rejects.toThrow(/tool/i);
    });
    expect(execute).not.toHaveBeenCalled(); expect(hooks.reserve).not.toHaveBeenCalled();
  });
  it("refuses a changed actor even for the admitted immutable reader", async () => {
    const { seed, hooks } = fixture();
    await runReassessmentExecution(seed, hooks, async () => {
      await expect(governedExecuteTool({ ...args(seed, "read_source_at_version", {}), userId: "other" })).rejects.toThrow(/actor|identity|dispatch/i);
    });
    expect(execute).not.toHaveBeenCalled();
  });
  it("executes and captures both admitted tools through the real governed entry", async () => {
    const { seed, hooks } = fixture();
    await runReassessmentExecution(seed, hooks, async () => {
      expect(await governedExecuteTool(args(seed, "read_source_at_version", { maxLines: 20 }))).toMatchObject({ success: true });
      expect(await governedExecuteTool(args(seed, seed.binding.writerToolName,
        { decision: "pass", reason: "Fixture only.", findings: [], resolvedFindingRefs: [] }))).toMatchObject({ success: true });
    });
    expect(execute.mock.calls.map(call => call[0])).toEqual(["read_source_at_version", seed.binding.writerToolName]);
    expect(hooks.reserve).toHaveBeenCalledTimes(2); expect(hooks.complete).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0]?.[1]).toMatchObject({ path: "design.md", version: "c".repeat(40), expectedBlobId: "d".repeat(40) });
  });
  it("executes nothing when pre-effect capture fails", async () => {
    const { seed, hooks } = fixture(); hooks.reserve = vi.fn(async () => { throw new Error("fixture storage unavailable"); });
    await expect(runReassessmentExecution(seed, hooks,
      () => governedExecuteTool(args(seed, "read_source_at_version", {})))).rejects.toThrow(/capture/i);
    expect(execute).not.toHaveBeenCalled();
  });
});
