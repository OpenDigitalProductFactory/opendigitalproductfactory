import { beforeEach, describe, expect, it, vi } from "vitest";
import { reassessmentBudgetFixture } from "../../test-support/reassessment-budget-fixture";
const mocks = vi.hoisted(() => ({ route: vi.fn(), tool: vi.fn(), fold: vi.fn(), rotate: vi.fn(), issue: vi.fn(), skills: vi.fn(), usage: vi.fn(), budgetEvent: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { agentModelConfig: { findUnique: vi.fn(async () => null) }, coworkerTurnMetric: { upsert: vi.fn(async () => ({})) } } }));
vi.mock("@/lib/routed-inference", () => ({ routeAndCall: mocks.route }));
vi.mock("@/lib/mcp-tools", () => ({ PLATFORM_TOOLS: [], toolsToOpenAIFormat: vi.fn(() => []) }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: mocks.tool }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: vi.fn(async () => ({ userId: "human", isSuperuser: false, platformRole: "developer" })) }));
vi.mock("@/lib/observability/heartbeat", () => ({ heartbeat: vi.fn(async () => true), withHeartbeatTicker: vi.fn(async (_id, fn) => fn()) }));
vi.mock("./native-mcp-executions", () => ({ foldNativeMcpExecutions: mocks.fold }));
vi.mock("./terminal-writer-route", () => ({ rotateTerminalWriterRoute: mocks.rotate }));
vi.mock("./runtime-issues", async load => ({ ...await load<typeof import("./runtime-issues")>(), recordRepeatedToolIssue: mocks.issue }));
vi.mock("@/lib/skills/runtime", () => ({ getSkillsForAgent: mocks.skills }));
vi.mock("@/lib/skills/usage-events", () => ({ recordSkillUsageEvents: mocks.usage }));
vi.mock("@/lib/inference/budget-gate", () => ({ checkAgentBudgetFromRegistry: vi.fn(async () => ({ status: "warning_95", actualTokens: 95, limitTokens: 100 })), writeBudgetEvent: mocks.budgetEvent }));

import { runAgenticLoop } from "./agentic-loop";
import { createInitiativeReviewTerminalToolPolicy } from "./terminal-tool-policy";
import { assertReassessmentPlan, ReassessmentExecutionError, reassessmentToolSurfaceDigest, runReassessmentExecution, type ReassessmentExecutionSeed } from "../routing/reassessment-execution-scope";

const reader = "read_source_at_version", writer = "record_initiative_design_review";
const names = [reader, writer];
const binding = { writerToolName: writer, itemId: "BI-FIXTURE", gate: "design-spec", expectedCurrentBaselineId: null,
  artifactRef: { kind: "repo-blob-at-commit" as const, repositoryFullName: "fixture/repo", path: "design.md", commitSha: "a".repeat(40), providerBlobId: "b".repeat(40) } };
const providerTools = names.map(name => ({ type: "function", function: { name, parameters: { type: "object", properties: {} } } }));
const plan = { providerId: "openai", modelId: "fixture", recipeId: null, contractFamily: "review", executionAdapter: "chat" as const,
  maxTokens: 100, providerSettings: {}, toolPolicy: {}, responsePolicy: {} };
function seed(): ReassessmentExecutionSeed {
  const startedAt = new Date().toISOString();
  return { schemaVersion: 1, taskRunId: "TR-FIXTURE", userId: "human", agentId: "reviewer", requestDigest: "c".repeat(64),
    executionFence: { schemaVersion: 1, requestDigest: "c".repeat(64), reservation: "reservation", dispatchClaim: "claim", authorityDigest: null },
    binding, startedAt, deadlineAt: new Date(Date.parse(startedAt) + 30_000).toISOString(), manifest: { artifactId: "manifest", digest: "d".repeat(64) },
    qualification: { schemaVersion: 1, compositionVersion: "restricted-review-http-v1", providerId: plan.providerId, modelId: plan.modelId,
      providerConnectionId: "account", providerConnectionVersion: "v1", providerConfigurationDigest: "e".repeat(64), qualificationDigest: "f".repeat(64),
      executionPlan: plan, toolSurfaceDigest: reassessmentToolSurfaceDigest(providerTools), budgetConfiguration: reassessmentBudgetFixture(),
      bounds: { maxProviderStarts: 10, maxDurationMs: 30_000, maxOutputTokens: 100 } } };
}
const params = () => ({ systemPrompt: "Read the immutable evidence and record the canonical review.", sensitivity: "internal" as const,
  chatHistory: [{ role: "user" as const, content: "Review the bound artifact." }], tools: names.map(name => ({ name, description: name, inputSchema: {},
    requiredCapability: null, executionMode: "immediate" as const, sideEffect: name === writer })), toolsForProvider: providerTools,
  userId: "human", agentId: "reviewer", taskRunId: "TR-FIXTURE", taskExecutionFence: seed().executionFence,
  threadId: "thread", routeContext: "/platform/build", taskType: "external-mcp", terminalToolPolicy: createInitiativeReviewTerminalToolPolicy(writer, names, binding.artifactRef)! });
const response = (name?: string) => ({ content: name ? "" : "The canonical assessment is recorded.", providerId: plan.providerId, modelId: plan.modelId,
  downgraded: false, downgradeMessage: null, inputTokens: 5, outputTokens: 5, toolsStripped: false, routeDecision: {},
  toolCalls: name ? [{ id: name, name, arguments: name === writer ? { decision: "pass" } : {} }] : [] });
const page = (partial = false) => ({ success: true, message: "Bound source", data: { repositoryFullName: binding.artifactRef.repositoryFullName,
  path: binding.artifactRef.path, version: binding.artifactRef.commitSha, blobId: binding.artifactRef.providerBlobId,
  content: "source", startLine: 1, endLine: 1, totalLines: partial ? 2 : 1, hasMore: partial, nextCursor: partial ? "next-page" : null } });
const inScope = (patch: Partial<ReturnType<typeof params>> = {}) => runReassessmentExecution(seed(), {
  open: async () => {}, reserve: async () => ({ reservationId: "fixture" }), complete: async () => {},
}, () => runAgenticLoop({ ...params(), ...patch }));
beforeEach(() => {
  vi.clearAllMocks(); mocks.skills.mockResolvedValue([{ skillId: "skill-fixture", allowedTools: names }]);
  mocks.tool.mockImplementation(async ({ toolName }) => toolName === reader ? page() : { success: true, message: "Recorded", data: { receiptId: "receipt" } });
  mocks.route.mockImplementation(async (_messages, _prompt, _sensitivity, options) => {
    assertReassessmentPlan({ providerId: plan.providerId, modelId: plan.modelId, plan, tools: options.tools });
    return response(mocks.route.mock.calls.length === 1 ? reader : mocks.route.mock.calls.length === 2 ? writer : undefined);
  });
});

describe("real core loop under a restricted reassessment scope", () => {
  it("completes reader then writer with the same ordered pair on every provider turn and no auxiliary writers", async () => {
    const result = await inScope();
    expect(result.failure).toBeUndefined(); expect(result.executedTools.map(tool => tool.name)).toEqual(names);
    expect(mocks.route).toHaveBeenCalledTimes(3);
    for (const call of mocks.route.mock.calls) expect(call[3].tools).toEqual(providerTools);
    expect(mocks.skills).not.toHaveBeenCalled(); expect(mocks.usage).not.toHaveBeenCalled(); expect(mocks.fold).not.toHaveBeenCalled();
    expect(mocks.rotate).not.toHaveBeenCalled(); expect(mocks.budgetEvent).not.toHaveBeenCalled();
  });
  it.each(["reassessment-capture-incomplete", "reassessment-effect-outcome-uncertain"])("preserves typed %s from actual route catch", async code => {
    const error = new ReassessmentExecutionError(code); mocks.route.mockRejectedValue(error);
    await expect(inScope()).rejects.toBe(error); expect(mocks.route).toHaveBeenCalledOnce();
  });
  it("preserves typed uncertainty from the actual tool catch before any further inference", async () => {
    const error = new ReassessmentExecutionError("reassessment-capture-incomplete"); mocks.tool.mockRejectedValue(error);
    await expect(inScope()).rejects.toBe(error); expect(mocks.route).toHaveBeenCalledOnce(); expect(mocks.tool).toHaveBeenCalledOnce();
  });
  it("keeps the pure repetition stop without publishing an auxiliary issue", async () => {
    mocks.route.mockResolvedValue(response(reader)); mocks.tool.mockResolvedValue(page(true));
    await inScope(); expect(mocks.tool).toHaveBeenCalledTimes(3); expect(mocks.issue).not.toHaveBeenCalled();
  });
  it("does not rotate routes or shrink the sealed pair after a prose nudge", async () => {
    mocks.route.mockResolvedValue(response()); await inScope();
    expect(mocks.rotate).not.toHaveBeenCalled();
    for (const call of mocks.route.mock.calls) expect(call[3].tools).toEqual(providerTools);
  });
  it.each(["load_tools", "record_execution_plan", "Task"])("rejects unexpected %s before loop-intrinsic interception or tool dispatch", async name => {
    mocks.route.mockResolvedValue(response(name)); await expect(inScope()).rejects.toThrow(/tool|reassessment/i);
    expect(mocks.route).toHaveBeenCalledOnce(); expect(mocks.tool).not.toHaveBeenCalled();
  });
});
