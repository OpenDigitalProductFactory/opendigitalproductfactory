import { beforeEach, describe, expect, it, vi } from "vitest";
import { reassessmentBudgetFixture } from "../../test-support/reassessment-budget-fixture";
import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { pageSource } from "../source-page";
import { REASSESSMENT_NATIVE_COMPOSITION as catalog, reassessmentNativeCatalogDigest } from "../shared/reassessment-native-composition";
const mocks = vi.hoisted(() => ({ route: vi.fn(), tool: vi.fn(), receipt: vi.fn(), metric: vi.fn(), fold: vi.fn(), rotate: vi.fn(), issue: vi.fn(), skills: vi.fn(), usage: vi.fn(), budgetEvent: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { agentModelConfig: { findUnique: vi.fn(async () => null) }, coworkerTurnMetric: { upsert: mocks.metric } } }));
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
import { assertReassessmentPlan, ReassessmentExecutionError, reassessmentToolSurfaceDigest, runReassessmentExecution,
  runReassessmentQualification, runReassessmentQualificationRequest, promoteReassessmentExecution, type ReassessmentExecutionSeed } from "../routing/reassessment-execution-scope";

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
  threadId: "thread", agentMessageId: "message", routeContext: "/platform/build", taskType: "external-mcp", canonicalReviewReceipt: mocks.receipt,
  terminalToolPolicy: createInitiativeReviewTerminalToolPolicy(writer, names, binding.artifactRef)! });
const response = (name?: string) => ({ content: name ? "" : "The canonical assessment is recorded.", providerId: plan.providerId, modelId: plan.modelId,
  downgraded: false, downgradeMessage: null, inputTokens: 5, outputTokens: 5, toolsStripped: false, routeDecision: {},
  toolCalls: name ? [{ id: name, name, arguments: name === writer ? { decision: "pass" } : {} }] : [] });
const page = (partial = false) => ({ success: true, message: "Bound source", data: { repositoryFullName: binding.artifactRef.repositoryFullName,
  path: binding.artifactRef.path, version: binding.artifactRef.commitSha, blobId: binding.artifactRef.providerBlobId,
  content: "source", startLine: 1, endLine: 1, totalLines: partial ? 2 : 1, hasMore: partial, nextCursor: partial ? "next-page" : null } });
const inScope = (patch: Partial<ReturnType<typeof params>> = {}) => runReassessmentExecution(seed(), {
  open: async () => {}, reserve: async () => ({ reservationId: "fixture" }), complete: async () => {},
}, () => runAgenticLoop({ ...params(), ...patch }));
async function inFiniteScope(fn: () => ReturnType<typeof runAgenticLoop>) {
  const base = seed(), limits = reassessmentBudgetFixture();
  const budget = reassessmentBudgetFixture({ configuredPerTaskLimit: 50_000,
    registryLimits: { ...limits.registryLimits, perTaskTokenLimit: 50_000 },
    executionConfigLimits: { ...limits.executionConfigLimits, perTaskTokenLimit: 50_000 } });
  const root = { schemaVersion: 2 as const, phase: "qualification" as const, taskRunId: base.taskRunId, userId: base.userId, agentId: base.agentId,
    compatibility: { schemaVersion: 1 as const, configDigest: "sha256:" + "1".repeat(64), sourceSha: "2".repeat(40), sourceContentHash: "3".repeat(64), contractSha256: "4".repeat(64),
      owners: { transport: { version: 2, sourceSha256: "5".repeat(64) }, approval: { version: 2, sourceSha256: "6".repeat(64) },
        worker: { version: 2, sourceSha256: "7".repeat(64) }, writer: { version: 2, sourceSha256: "8".repeat(64) } } },
    requestDigest: base.requestDigest, executionFence: base.executionFence, binding: base.binding, budgetConfiguration: budget,
    bounds: base.qualification.bounds, nativeObservationUrls: ["http://runtime.invalid/version"], startedAt: base.startedAt,
    deadlineAt: base.deadlineAt, manifest: base.manifest };
  const q = { ...base.qualification, providerId: "local", budgetConfiguration: budget, providerConnectionVersion: "1".repeat(64),
    executionPlan: { ...plan, providerId: "local", providerConnectionId: "account", providerConnectionVersion: "1".repeat(64), accountAuthMethod: "none", executionChannel: "local-runtime" },
    finiteTokenProof: { schemaVersion: 1 as const, kind: "dmr-native-messages-v1" as const, apiRoot: "http://runtime.invalid", runtimeVersion: "v1.2.8" as const,
      modelDigest: catalog.modelDigest, engineIdentity: `Running: llama.cpp ${catalog.engineBuild} (sha256:${catalog.engineArchiveDigest}) ${catalog.engineSourceCommit.slice(0, 7)}`,
      engineArtifactDigest: `sha256:${catalog.engineArchiveDigest}`, engineSourceCommit: "72874f5" as const,
      templateDigest: catalog.templateDigest, configDigest: "5".repeat(64) },
    nativeRuntime: { schemaVersion: 2 as const, catalogDigest: reassessmentNativeCatalogDigest(), observationDigest: "7".repeat(64), spendAwareBudgetClass: "balanced" as const } };
  const { qualificationDigest: _, ...unsigned } = q;
  q.qualificationDigest = createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
  return runReassessmentQualification(root, { open: async () => {}, reserve: async () => ({ reservationId: "fixture" }), complete: async () => {},
    readExecutionSeal: async (_context, prefix) => ({ schemaVersion: 2, root: { schemaVersion: 2, manifestArtifactId: root.manifest.artifactId, manifestDigest: root.manifest.digest },
      taskRunId: root.taskRunId, userId: root.userId, agentId: root.agentId, requestDigest: root.requestDigest,
      executionFence: root.executionFence, binding: root.binding, qualificationPrefix: prefix, qualification: q,
      authorityDecisionId: "fixture-decision", sealedAt: new Date().toISOString() }) }, async () => {
    await runReassessmentQualificationRequest({ method: "GET", url: root.nativeObservationUrls[0] }, async () => ({ version: "fixture" }));
    return promoteReassessmentExecution(fn);
  });
}
beforeEach(() => {
  binding.artifactRef.providerBlobId = "b".repeat(40);
  mocks.receipt.mockReset(); mocks.route.mockReset(); mocks.tool.mockReset();
  vi.clearAllMocks(); mocks.skills.mockResolvedValue([{ skillId: "skill-fixture", allowedTools: names }]);
  mocks.metric.mockResolvedValue({});
  mocks.tool.mockImplementation(async ({ toolName }) => toolName === reader ? page() : { success: true, message: "Recorded", data: { receiptId: "receipt" } });
  mocks.receipt.mockResolvedValue({ receiptId: "receipt", summary: "The verified canonical assessment is recorded." });
  mocks.route.mockImplementation(async (_messages, _prompt, _sensitivity, options) => {
    assertReassessmentPlan({ providerId: plan.providerId, modelId: plan.modelId, plan, tools: options.tools });
    return response(mocks.route.mock.calls.length === 1 ? reader : mocks.route.mock.calls.length === 2 ? writer : undefined);
  });
});

describe("real core loop under a restricted reassessment scope", () => {
  it("preloads the full immutable source before inference and protects source, criteria and correction history", async () => {
    const source = "FIRST" + "中".repeat(14_000) + "MIDDLE" + "z".repeat(14_000) + "LAST";
    binding.artifactRef.providerBlobId = createHash("sha1").update(`blob ${Buffer.byteLength(source)}\0${source}`).digest("hex");
    const correction = "COMPLETE-CORRECTION-DETAIL".repeat(500), criteria = "RETAIN-ALL-REVIEW-CRITERIA".repeat(500);
    let writerCalls = 0;
    mocks.tool.mockImplementation(async ({ toolName, rawParams }) => toolName === reader
      ? { success: true, message: "Actual reader page", data: { ...pageSource({ content: source, ref: binding.artifactRef.commitSha,
        path: binding.artifactRef.path, blobId: binding.artifactRef.providerBlobId, ...rawParams }), repositoryFullName: binding.artifactRef.repositoryFullName } }
      : ++writerCalls === 1 ? { success: false, error: "malformed-receipt", message: "Correct evidence", data: { detail: correction } }
      : { success: true, message: "Recorded", data: { receiptId: "receipt" } });
    mocks.receipt.mockResolvedValueOnce(null);
    mocks.route.mockImplementation(async messages => {
      expect(mocks.tool.mock.calls.filter(([call]) => call.toolName === reader)).toHaveLength(2);
      const input = JSON.stringify(messages);
      expect(input).toContain(source); expect(input).toContain(criteria);
      if (mocks.route.mock.calls.length === 2) expect(input).toContain(correction);
      return response(writer);
    });
    const result = await inFiniteScope(() => runAgenticLoop({ ...params(), chatHistory: [{ role: "user", content: criteria },
      ...Array.from({ length: 28 }, (_, n) => ({ role: "user" as const, content: `history-${n}` }))] }));
    expect(result.executedTools.filter(tool => tool.name === reader).map(tool => tool.result.data?.content).join("")).toBe(source);
    expect(mocks.route).toHaveBeenCalledTimes(2);
  });
  it("starts no inference when the finite preload reader refuses", async () => {
    mocks.tool.mockResolvedValue({ success: false, error: "source-unavailable", message: "Read unavailable" });
    mocks.route.mockResolvedValue(response(writer));
    await expect(inFiniteScope(() => runAgenticLoop(params()))).rejects.toThrow(/preload|source/i);
    expect(mocks.route).not.toHaveBeenCalled();
  });
  it("completes reader then writer with the same ordered pair on every provider turn and no auxiliary writers", async () => {
    const result = await inScope();
    expect(result.failure).toBeUndefined(); expect(result.executedTools.map(tool => tool.name)).toEqual(names);
    expect(mocks.route).toHaveBeenCalledTimes(2);
    expect(mocks.receipt).toHaveBeenCalledOnce();
    expect(mocks.receipt).toHaveBeenCalledWith(result.executedTools[1].result);
    await vi.waitFor(() => expect(mocks.metric).toHaveBeenCalledOnce());
    expect(mocks.metric.mock.calls[0][0].create).toMatchObject({ dispatches: 2, executedTools: 2 });
    for (const call of mocks.route.mock.calls) expect(call[3].tools).toEqual(providerTools);
    expect(mocks.skills).not.toHaveBeenCalled(); expect(mocks.usage).not.toHaveBeenCalled(); expect(mocks.fold).not.toHaveBeenCalled();
    expect(mocks.rotate).not.toHaveBeenCalled(); expect(mocks.budgetEvent).not.toHaveBeenCalled();
  });
  it.each(["pass", "fail"])("stops on a verified canonical %s before a trailing tool in the same response", async decision => {
    mocks.receipt.mockResolvedValue({ receiptId: `receipt-${decision}`, summary: `Verified ${decision}.` });
    mocks.route.mockImplementation(async () => mocks.route.mock.calls.length === 1 ? response(reader) : {
      ...response(writer), toolCalls: [...response(writer).toolCalls, { id: "trailing-reader", name: reader, arguments: {} }],
    });
    const result = await inScope();
    expect(result.content).toBe(`Verified ${decision}.`);
    expect(result.executedTools.map(tool => tool.name)).toEqual(names);
    expect(mocks.tool).toHaveBeenCalledTimes(2); expect(mocks.route).toHaveBeenCalledTimes(2);
  });
  it("requires the server receipt checker before any restricted inference", async () => {
    await expect(inScope({ canonicalReviewReceipt: undefined })).rejects.toThrow(/receipt.*required/);
    expect(mocks.route).not.toHaveBeenCalled(); expect(mocks.tool).not.toHaveBeenCalled();
  });
  it("preserves a typed receipt-readback hold before another tool or generation", async () => {
    const error = new ReassessmentExecutionError("reassessment-effect-outcome-uncertain"); mocks.receipt.mockRejectedValue(error);
    await expect(inScope()).rejects.toBe(error);
    expect(mocks.route).toHaveBeenCalledTimes(2); expect(mocks.tool).toHaveBeenCalledTimes(2);
  });
  it("allows a fully observed writer refusal to receive a later bounded semantic correction", async () => {
    let writerCalls = 0;
    mocks.tool.mockImplementation(async ({ toolName }) => toolName === reader ? page() : ++writerCalls === 1
      ? { success: false, error: "malformed-receipt", message: "Correct the finding evidence." }
      : { success: true, message: "Recorded", data: { receiptId: "receipt" } });
    mocks.receipt.mockResolvedValueOnce(null);
    mocks.route.mockImplementation(async () => response(mocks.route.mock.calls.length === 1 ? reader : writer));
    const result = await inScope();
    expect(result.failure).toBeUndefined(); expect(result.executedTools.map(tool => tool.name)).toEqual([reader, writer, writer]);
    expect(mocks.route).toHaveBeenCalledTimes(3); expect(mocks.receipt).toHaveBeenCalledTimes(2);
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
