import { beforeEach, describe, expect, it, vi } from "vitest";
import { reassessmentBudgetFixture } from "../../test-support/reassessment-budget-fixture";
const mocks = vi.hoisted(() => ({ available: vi.fn(), local: vi.fn(), fidelity: vi.fn(), profession: vi.fn(), surface: vi.fn(),
  reporting: vi.fn(), review: vi.fn(), reflection: vi.fn(), patterns: vi.fn() }));
vi.mock("@dpf/db", () => {
  const tx = { taskRun: { create: vi.fn() }, taskMessage: { create: vi.fn() } };
  return { prisma: { ...tx, $transaction: vi.fn(async callback => callback(tx)) } };
});
vi.mock("@/lib/operate/scheduled-jobs/scheduled-reporting-authority", () => ({ resolveScheduledReportingContext: mocks.reporting }));
vi.mock("@/lib/platform-runtime/work-admission", () => ({ admitRuntimeGuardedWork: vi.fn() }));
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
import { createAutonomousWorkRun, executeAutonomousAgenticLoop, resolveAutonomousWorkTools } from "./autonomous-work-run";
import { runReassessmentExecution, type ReassessmentExecutionSeed } from "@/lib/routing/reassessment-execution-scope";

const binding = { itemId: "BI-FIXTURE", gate: "design-spec", writerToolName: "record_initiative_design_review",
  expectedCurrentBaselineId: null, artifactRef: { kind: "repo-blob-at-commit" as const, repositoryFullName: "fixture/repo",
    commitSha: "a".repeat(40), path: "design.md", providerBlobId: "b".repeat(40) } };
const names = ["read_source_at_version", binding.writerToolName];
const tool = (name: string) => ({ name, description: "Fixture", inputSchema: { type: "object", properties: {} },
  requiredCapability: null, sideEffect: false, executionMode: "immediate" });
beforeEach(() => {
  vi.clearAllMocks(); mocks.reporting.mockResolvedValue(null); mocks.available.mockResolvedValue([...names, "run_shell", "load_tools"].map(tool));
  mocks.local.mockRejectedValue(new Error("A restricted path must not probe the engine."));
  mocks.fidelity.mockRejectedValue(new Error("A restricted path must not probe fidelity."));
  mocks.profession.mockResolvedValue({ systemPrompt: "Captured review instructions.", grounded: false });
  mocks.surface.mockResolvedValue({ systemPrompt: "Captured review instructions.", grounded: false });
  mocks.review.mockResolvedValue("none"); mocks.patterns.mockResolvedValue({ skippedReason: "missing-task-run" });
});
const input = { userContext: { userId: "human", platformRole: "ceo", isSuperuser: true }, agentId: "reviewer",
  requiredToolNames: names, restrictedReviewBinding: binding };
describe("restricted review tool resolution", () => {
  it("commits a server-owned allocation hook inside the TaskRun creation transaction", async () => {
    const { prisma } = await import("@dpf/db");
    const row = { id: "record", taskRunId: "TR-MCP-current", contextId: "thread" };
    vi.mocked(prisma.taskRun.create).mockResolvedValue(row as never);
    const created = vi.fn(async (tx, run) => {
      expect(tx.taskRun.create).toBe(prisma.taskRun.create);
      expect(run).toEqual(row);
      expect(prisma.taskRun.create).toHaveBeenCalled();
      throw new Error("allocation persistence failed");
    });
    await expect(createAutonomousWorkRun({ trigger: "external-mcp", userId: "human", agentId: "reviewer", routeContext: "/build",
      title: "Independent review", objective: "Review exact source", prompt: "Review exact source", afterTaskCreated: created,
    })).rejects.toThrow("allocation persistence failed");
    expect(created).toHaveBeenCalledOnce();
  });
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
    const canonicalReviewReceipt = vi.fn(async () => null);
    vi.mocked(runAgenticLoop).mockResolvedValue({ content: "Fixture result.", executedTools: [] } as never);
    await runReassessmentExecution(seed, { open: async () => {}, reserve: async () => ({ reservationId: "fixture" }), complete: async () => {} },
      () => executeAutonomousAgenticLoop({ userId: seed.userId, agentId: seed.agentId, taskRunId: seed.taskRunId,
        taskExecutionFence: seed.executionFence, threadId: "fixture", routeContext: "/build", taskType: "external-mcp",
        systemPrompt: "Captured review instructions.", chatHistory: [], sensitivity: "internal", tools: names.map(tool) as never,
        toolsForProvider: [], deferredTools: [], canonicalReviewReceipt }));
    expect(runAgenticLoop).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: "Captured review instructions.", taskRunId: seed.taskRunId, canonicalReviewReceipt }));
    expect(mocks.profession).not.toHaveBeenCalled(); expect(mocks.surface).not.toHaveBeenCalled(); expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.reflection).not.toHaveBeenCalled(); expect(mocks.patterns).not.toHaveBeenCalled();
  });
});

it("prepares only the finite engagement's already authorized readers before any ambient runtime probe", async () => {
  const runtime = await import("@/lib/inference/local-model-context-reconcile");
  const { resolveAutonomousWorkTools } = await import("./autonomous-work-run");
  const names = ["read_source_at_version", "wiki_query", "search_ux_critique_corpus"];
  const available = [...names, "delete_data"].map(name => ({ name, description: name, inputSchema: { type: "object" }, requiredCapability: null }));
  mocks.available.mockResolvedValue(available);
  vi.mocked(runtime.resolveLocalServingPosture).mockClear();
  const binding = { version: 1, engagementId: "CE-1FE20783", offerId: "offer-ux-design-critique", serviceId: "svc-ux-design-critique",
    providerAgentId: "ux-design-critic", actorAgentId: "actor", userId: "owner", workroomId: "WC-9C02621A", stageKey: "accept", inputDigest: "a".repeat(64),
    artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "fixture/repo", commitSha: "b".repeat(40), path: "prototype.html", providerBlobId: "c".repeat(40) },
    visualEvidenceRef: { kind: "document-version", repositoryFullName: "fixture/repo", versionId: "images", valueDigest: "d".repeat(64) },
    presentAssessment: { schemaVersion: 1, policyArtifactId: "ta-engagement-present-policy-" + "e".repeat(64), policyDigest: "f".repeat(64), originalTaskRunId: "TR-MCP-original", originalRequestDigest: "1".repeat(64) } };
  const input = { agentId: "ux-design-critic", userContext: { platformRole: "developer", isSuperuser: false }, requiredToolNames: names, restrictedEngagementBinding: binding };
  const result = await resolveAutonomousWorkTools(input as never);
  expect(runtime.resolveLocalServingPosture).not.toHaveBeenCalled();
  expect(result.tools.map(t => t.name)).toEqual(names); expect(result.deferredTools).toEqual([]);
  // A finite reader list must still intersect the current persisted commission.
  const reportingInput = { ...input, userContext: { ...input.userContext, userId: "owner" },
    taskRunId: "TR-REPORTING", scheduledReportingMode: "read-only-history" };
  mocks.reporting.mockResolvedValue({ mode: "read-only-history" });
  mocks.available.mockResolvedValue(available.map(t => ({ ...t, sideEffect: t.name === "wiki_query", executionMode: "immediate" })));
  await expect(resolveAutonomousWorkTools(reportingInput as never)).rejects.toThrow("engagement-present-tool-surface-unavailable");
  expect(mocks.reporting).toHaveBeenCalledWith("owner", expect.objectContaining({ taskRunId: "TR-REPORTING", agentId: "ux-design-critic" }));
  mocks.available.mockResolvedValue(available.map(t => ({ ...t, sideEffect: false, executionMode: "immediate" })));
  mocks.reporting.mockResolvedValue(null);
  await expect(resolveAutonomousWorkTools(reportingInput as never)).rejects.toThrow("current persisted commission");

  mocks.available.mockResolvedValue(available.filter(t => t.name !== "read_source_at_version"));
  await expect(resolveAutonomousWorkTools(input as never)).rejects.toThrow("engagement-present-tool-surface-unavailable");
});
