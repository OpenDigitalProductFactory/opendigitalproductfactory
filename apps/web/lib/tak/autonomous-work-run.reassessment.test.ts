import { beforeEach, describe, expect, it, vi } from "vitest";
import { reassessmentBudgetFixture } from "../../test-support/reassessment-budget-fixture";
const mocks = vi.hoisted(() => ({ available: vi.fn(), local: vi.fn(), fidelity: vi.fn(), profession: vi.fn(), surface: vi.fn(),
  review: vi.fn(), reflection: vi.fn(), patterns: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/tak/agentic-loop", () => ({ runAgenticLoop: vi.fn() }));
vi.mock("@/lib/mcp-tools", () => ({ getAvailableTools: mocks.available,
  toolsToOpenAIFormat: (tools: Array<{ name: string; inputSchema: unknown }>) => tools.map(tool => ({ type: "function", function: { name: tool.name, parameters: tool.inputSchema } })) }));
vi.mock("@/lib/inference/local-model-context-reconcile", () => ({ resolveLocalServingPosture: mocks.local }));
vi.mock("@/lib/routing/local-tool-fidelity", () => ({ resolveLocalToolFidelityCeiling: mocks.fidelity }));
vi.mock("@/lib/tak/agent-grants", () => ({ getAgentToolGrantsAsync: vi.fn(async () => []) }));
vi.mock("@/lib/tak/profession-grounding", () => ({ groundPromptWithProfessionCorpus: mocks.profession, defaultProfessionGroundingDeps: {} }));
vi.mock("@/lib/coworker/authorized-surface-prompt-grounding", () => ({ groundPromptWithAuthorizedSurface: mocks.surface,
  isAuthorizedSurfaceGuidanceRequest: () => false, closeAuthorizedSurfacePromptGrounding: vi.fn() }));
vi.mock("@/lib/golden-triangle/coworker-review", () => ({ resolveCoworkerReviewPattern: mocks.review }));
vi.mock("@/lib/tak/reflection-triggers", () => ({ processRuntimeIssueReflection: mocks.reflection }));
vi.mock("@/lib/tak/pattern-observer-service", () => ({ observeWorkPatternsAfterRun: mocks.patterns }));
import { executeAutonomousAgenticLoop, resolveAutonomousWorkTools } from "./autonomous-work-run";
import { runReassessmentExecution, type ReassessmentExecutionSeed } from "@/lib/routing/reassessment-execution-scope";

const binding = { itemId: "BI-FIXTURE", gate: "design-spec", writerToolName: "record_initiative_design_review",
  expectedCurrentBaselineId: null, artifactRef: { kind: "repo-blob-at-commit" as const, repositoryFullName: "fixture/repo",
    commitSha: "a".repeat(40), path: "design.md", providerBlobId: "b".repeat(40) } };
const names = ["read_source_at_version", binding.writerToolName];
const tool = (name: string) => ({ name, description: "Fixture", inputSchema: { type: "object", properties: {} },
  requiredCapability: null, sideEffect: false, executionMode: "immediate" });
beforeEach(() => {
  vi.clearAllMocks(); mocks.available.mockResolvedValue([...names, "run_shell", "load_tools"].map(tool));
  mocks.local.mockRejectedValue(new Error("A restricted path must not probe the engine."));
  mocks.fidelity.mockRejectedValue(new Error("A restricted path must not probe fidelity."));
  mocks.profession.mockResolvedValue({ systemPrompt: "Captured review instructions.", grounded: false });
  mocks.surface.mockResolvedValue({ systemPrompt: "Captured review instructions.", grounded: false });
  mocks.review.mockResolvedValue("none"); mocks.patterns.mockResolvedValue({ skippedReason: "missing-task-run" });
});
const input = { userContext: { userId: "human", platformRole: "ceo", isSuperuser: true }, agentId: "reviewer",
  requiredToolNames: names, restrictedReviewBinding: binding };
describe("restricted review tool resolution", () => {
  it("retains normal authorization and resolves exactly the bound pair without runtime probes", async () => {
    const result = await resolveAutonomousWorkTools(input);
    expect(mocks.available).toHaveBeenCalledOnce();
    expect(result.tools.map(entry => entry.name)).toEqual(names);
    expect(result.deferredTools).toEqual([]);
    expect(result.toolsForProvider).toHaveLength(2);
    expect(mocks.local).not.toHaveBeenCalled(); expect(mocks.fidelity).not.toHaveBeenCalled();
  });
  it("refuses a missing normal grant instead of discovering or broadening the surface", async () => {
    mocks.available.mockResolvedValue([tool("read_source_at_version"), tool("load_tools")]);
    await expect(resolveAutonomousWorkTools(input)).rejects.toThrow(/authorized|surface|tool/i);
    expect(mocks.local).not.toHaveBeenCalled(); expect(mocks.fidelity).not.toHaveBeenCalled();
  });
  it("refuses an auxiliary required tool before runtime probing", async () => {
    await expect(resolveAutonomousWorkTools({ ...input, requiredToolNames: [...names, "load_tools"] })).rejects.toThrow(/surface|tool/i);
    expect(mocks.local).not.toHaveBeenCalled(); expect(mocks.fidelity).not.toHaveBeenCalled();
  });
  it("runs the captured loop without auxiliary grounding, deliberation or asynchronous writers", async () => {
    const startedAt = new Date().toISOString();
    const seed: ReassessmentExecutionSeed = { schemaVersion: 1, taskRunId: "TR-FIXTURE", userId: "human", agentId: "reviewer",
      requestDigest: "a".repeat(64), executionFence: { schemaVersion: 1, requestDigest: "a".repeat(64), reservation: null, dispatchClaim: null, authorityDigest: null },
      binding, startedAt, deadlineAt: new Date(Date.parse(startedAt) + 30_000).toISOString(), manifest: { artifactId: "fixture", digest: "b".repeat(64) },
      qualification: { schemaVersion: 1, compositionVersion: "restricted-review-http-v1", providerId: "local", modelId: "fixture",
        providerConnectionId: "fixture", providerConnectionVersion: "v1", providerConfigurationDigest: "c".repeat(64),
        toolSurfaceDigest: "d".repeat(64), qualificationDigest: "e".repeat(64),
        executionPlan: { providerId: "local", modelId: "fixture", recipeId: null, contractFamily: "review", executionAdapter: "chat",
          maxTokens: 100, providerSettings: {}, toolPolicy: {}, responsePolicy: {} },
        budgetConfiguration: reassessmentBudgetFixture(),
        bounds: { maxProviderStarts: 2, maxDurationMs: 30_000, maxOutputTokens: 100 } } };
    const { runAgenticLoop } = await import("./agentic-loop");
    vi.mocked(runAgenticLoop).mockResolvedValue({ content: "Fixture result.", executedTools: [] } as never);
    await runReassessmentExecution(seed, { open: async () => {}, reserve: async () => ({ reservationId: "fixture" }), complete: async () => {} },
      () => executeAutonomousAgenticLoop({ userId: seed.userId, agentId: seed.agentId, taskRunId: seed.taskRunId,
        taskExecutionFence: seed.executionFence, threadId: "fixture", routeContext: "/build", taskType: "external-mcp",
        systemPrompt: "Captured review instructions.", chatHistory: [], sensitivity: "internal", tools: names.map(tool) as never,
        toolsForProvider: [], deferredTools: [] }));
    expect(runAgenticLoop).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: "Captured review instructions.", taskRunId: seed.taskRunId }));
    expect(mocks.profession).not.toHaveBeenCalled(); expect(mocks.surface).not.toHaveBeenCalled(); expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.reflection).not.toHaveBeenCalled(); expect(mocks.patterns).not.toHaveBeenCalled();
  });
});
