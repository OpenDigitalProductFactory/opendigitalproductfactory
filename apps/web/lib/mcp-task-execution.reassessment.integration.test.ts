/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

// Connected wiring evidence for the existing q0 scaffold, NOT a live finite
// qualification, semantic review, reassessment admission or SQL/concurrency proof.
// No worker/loop/router/capture/dispatcher/pack handler is replaced here.
type Row = Record<string, any>;
const fixture = vi.hoisted(() => {
  const state: Row = { methods: {}, requests: [], repoRequests: [], artifacts: [], executions: [], activities: [], authorities: [], log: [] };
  const db: Row = new Proxy({}, { get(_target, model: string) {
    if (model === "$transaction") return async (fn: (tx: Row) => Promise<unknown>) => {
      const saved = structuredClone({ artifacts: state.artifacts, executions: state.executions, activities: state.activities });
      try { return await fn(db); } catch (error) { Object.assign(state, saved); throw error; }
    };
    if (model === "$queryRaw") return async (query: TemplateStringsArray, ...values: unknown[]) => {
      const sql = query.join("?");
      const taskLock = /^SELECT "id" FROM "TaskRun" WHERE "taskRunId" = \? FOR (UPDATE|SHARE)$/.test(sql);
      const itemLock = sql === 'SELECT "id" FROM "BacklogItem" WHERE "id" = ? FOR UPDATE';
      if ((!taskLock && !itemLock) || values.length !== 1 || values[0] !== (taskLock ? state.run.taskRunId : "item-row"))
        throw new Error(`Unexpected synthetic row lock: ${sql}`);
      state.locks.push(sql); return [{ id: taskLock ? state.run.id : "item-row" }];
    };
    return new Proxy({}, { get(_row, method: string) {
      return async (args: Row) => {
        const fn = state.methods[`${model}.${method}`];
        if (!fn) { state.unconfigured?.push(`${model}.${method}`); throw new Error(`Unconfigured synthetic storage port: ${model}.${method}`); }
        return fn(args);
      };
    } });
  } });
  return { state, db };
});
vi.mock("@dpf/db", () => ({ prisma: fixture.db, Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } } }));
vi.mock("./inference/budget-gate", async original => {
  const actual = await original<typeof import("./inference/budget-gate")>();
  return { ...actual, readReassessmentBudgetConfiguration: (id: string) =>
    actual.readReassessmentBudgetConfiguration(id, () => fixture.state.registry) };
});
vi.mock("./inference/provider-inference-transport", async original => ({
  ...await original<typeof import("./inference/provider-inference-transport")>(),
  providerInferenceFetch: (...args: unknown[]) => fixture.state.providerFetch(...args),
}));
vi.mock("./contributor-change-lanes/github-rest-reader", async original => ({
  ...await original<typeof import("./contributor-change-lanes/github-rest-reader")>(),
  createGithubReadTransport: () => ({ fetch: (...args: unknown[]) => fixture.state.repoFetch(...args), close: async () => {} }),
}));
vi.mock("./git-utils", () => ({ isGitAvailable: async () => false,
  gitBlobId: () => { throw new Error("Unexpected local Git access"); }, gitShow: () => { throw new Error("Unexpected local Git access"); } }));
vi.mock("./tak/agent-routing-server", () => ({
  resolveAgentForRouteWithPrompts: async () => fixture.state.agentInfo,
  resolveAgentByIdWithPrompts: async () => fixture.state.agentInfo,
}));
vi.mock("./govern/current-user-context", () => ({ currentUserContext: async () => fixture.state.user }));

import { executeRemoteTaskAttempt } from "./mcp-task-execution";
import { _setGovernanceForTests } from "./mcp-governed-execute";
import { qualifyReassessmentExecution } from "./inference/reassessment-execution-qualification";
import { resolveAutonomousWorkTools } from "./tak/autonomous-work-run";
import { reassessmentExecutionManifestDigest } from "./mcp-task-reassessment-capture";
import { reassessmentToolSurfaceDigest } from "./routing/reassessment-execution-scope";
import { invalidateRoutingLoaderCache } from "./routing/loader";
import { EMPTY_CAPABILITIES, EMPTY_PRICING } from "./routing/model-card-types";
import { resolveSteering, resolveBoundInitiativeReviewBinding, deriveCoworkerApprovalPolicy } from "./govern/authority/resolve-coworker-tool-authority";
import type { InitiativeReviewBinding } from "./mcp-task-review-contract";

const s = fixture.state;
const userId = "integration-user", agentId = "AGT-INTEGRATION-Q0", taskRunId = "TR-INTEGRATION-Q0";
const reader = "read_source_at_version", itemId = "BI-INTEGRATION-Q0";
let writer = "record_initiative_evidence";
const source = "# Synthetic research\nThe ownership and capture boundaries are explicit.\n";
const commitSha = "a".repeat(40), blobId = createHash("sha1").update(`blob ${Buffer.byteLength(source)}\0${source}`).digest("hex");
const artifactRef = { kind: "repo-blob-at-commit" as const, repositoryFullName: "fixture/repository", commitSha,
  path: "research.md", providerBlobId: blobId };
const binding: InitiativeReviewBinding = { writerToolName: writer, itemId, gate: "research", artifactRef };
const requestDigest = "b".repeat(64);
const fence = { schemaVersion: 1 as const, reservation: "fixture-reservation", dispatchClaim: "fixture-dispatch", authorityDigest: null, requestDigest };
const grants = ["file_read", "backlog_read", "initiative_evidence_write"];
const parsed = { agentId, routeContext: "/platform/build", title: "Synthetic connected capture", objective: "Review fixture research",
  prompt: "Read the bound immutable research and record its research evidence.", idempotencyKey: "fixture-only",
  riskClass: "bounded-write" as const, collaborationKind: "handoff" as const,
  authorityScope: [`backlog-item:${itemId}`, `tool:${reader}`, `tool:${writer}`, ...grants], initiativeReviewBinding: binding };

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return (Array.isArray(value) ? value : [value]).every(v => matches(row, v));
    if (key === "OR") return value.some((v: Row) => matches(row, v));
    if (value && typeof value === "object" && !(value instanceof Date)) {
      const keys = Object.keys(value).sort().join(",");
      if (keys === "in" && Array.isArray(value.in)) return value.in.includes(row[key]);
      if (keys === "gte") return row[key] >= value.gte;
      if (keys === "equals,path" && Array.isArray(value.path)) return value.path.reduce((v: any, k: string) => v?.[k], row[key]) === value.equals;
      if (keys === "equals") return row[key] === value.equals;
      s.unsupported.push({ key, value });
      throw new Error(`Unsupported synthetic storage predicate: ${key} ${JSON.stringify(value)}`);
    }
    return value instanceof Date ? row[key]?.getTime() === value.getTime() : row[key] === value;
  });
}
const rows = (name: string, args: Row) => s[name].filter((row: Row) => matches(row, args.where));
function put(name: string, data: Row) {
  const row = { id: `${name}-${s[name].length + 1}`, createdAt: new Date(), recordedAt: new Date(), ...data };
  s[name].push(row); return row;
}
function authorityInput({ execution, tool, agentGrantAllowed }: Row): Row {
  const bound = resolveBoundInitiativeReviewBinding(s.run, tool.name);
  return { organizationId: "platform", authContext: {
    principalId: s.samePrincipal ? "PRN-AUTHOR" : "PRN-REVIEWER", principalAliases: [], population: "workforce", platformRole: "HR-000", isSuperuser: true,
    employeeId: "EMP-REVIEWER", managerScope: { directReportIds: [], indirectReportIds: [] }, teamIds: [],
    accountScope: { accountIds: [], contactIds: [], partnerAccountIds: [] },
    sensitivityClearance: ["public", "internal", "confidential", "restricted"],
    authentication: { source: "api-token", methods: [], contextClassReference: null }, actingHumanUserId: userId,
    actingAgentId: agentId, delegationGrantIds: [], grantedCapabilities: ["view_platform", "view_backlog", "manage_backlog"],
  }, action: { toolName: tool.name, requiredCapability: tool.requiredCapability, agentGrantAllowed, sideEffect: tool.sideEffect,
    executionMode: tool.executionMode, routeContext: execution.context.routeContext,
    approvalPolicy: deriveCoworkerApprovalPolicy({ hitlTierDefault: 3, hitlPolicy: null, serverBoundInitiativeReview: Boolean(bound) }) },
  subject: { kind: "backlog-item", id: itemId }, delegation: null, integration: { required: false, state: "not-required" },
  dataPolicy: { sensitivity: "internal", maskingRequired: false, maskingSatisfied: true, decisionVersionsCurrent: true },
  task: { taskRunId, parentTaskRunId: null, ...(bound ? { initiativeReviewBinding: bound } : {}) }, rawParams: execution.rawParams,
  steering: resolveSteering({ initiativeReviewBinding: bound, roomAuthority: null }) };
}

function installStorage() {
  const provider = { id: "provider-row", providerId: "fixture-http", name: "Fixture HTTP", status: "active", retiredAt: null,
    endpointType: "chat", baseUrl: "https://provider.invalid/v1", endpoint: null, authMethod: "none", authHeader: null,
    supportsToolUse: true, supportsStructuredOutput: true, supportsStreaming: true, sensitivityClearance: ["public", "development", "internal", "confidential", "restricted"],
    modelRestrictions: [], maxContextTokens: 200000, maxOutputTokens: 8192, avgLatencyMs: 1, recentFailureRate: 0,
    costModel: "token", inputPricePerMToken: 1, outputPricePerMToken: 1 };
  const account = { id: "account-row", connectionId: "provider-default-fixture-http", providerId: provider.providerId,
    status: "active", authMethod: "local", executionChannel: "direct-api", credentialEntryId: null, credentialEntry: null,
    updatedAt: new Date("2026-10-01"), accessibleModelIds: ["fixture-model"], modelsVerifiedAt: null,
    evidenceStatus: "operator-attested", accountClass: "self_hosted", supplierContractId: null, lastReviewedAt: null };
  const profile = { id: "model-row", providerId: provider.providerId, modelId: "fixture-model", friendlyName: "Fixture model", provider,
    modelStatus: "active", retiredAt: null, supportsToolUse: true, capabilityOverrides: {}, maxContextTokens: 200000, maxOutputTokens: 8192,
    reasoning: 100, codegen: 100, toolFidelity: 100, instructionFollowingScore: 100, structuredOutputScore: 100,
    conversational: 100, contextRetention: 100, customScores: {}, profileSource: "evaluated", profileConfidence: "high",
    qualityTier: "frontier", modelClass: "chat", modelFamily: null, inputModalities: ["text"], outputModalities: ["text"],
    capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, structuredOutput: true, streaming: true, thinking: false },
    pricing: { ...EMPTY_PRICING, inputPerMToken: 1, outputPerMToken: 1 }, outputPricePerMToken: 1, supportedParameters: [],
    deprecationDate: null, metadataSource: "inferred", metadataConfidence: "high", perRequestLimits: null };
  const agent = { id: "agent-row", agentId, slugId: "integration-q0", lifecycleStage: "production", status: "active",
    toolGrants: grants.map(grantKey => ({ grantKey })), toolGrantRevocations: [],
    executionConfig: { id: "execution-config", agentId: "agent-row", dailyTokenLimit: 200000, perTaskTokenLimit: 0,
      timeoutSeconds: 60, maxTokens: 8192, executionType: "in_process" } };
  s.registry = { agents: [{ agent_id: agentId, agent_name: "integration-q0", config_profile: {
    token_budget: { daily_limit: 200000, per_task_limit: 0 }, execution_runtime: { type: "in_process", timeout_seconds: 60 },
    model_binding: { max_tokens: 8192 } } }] };
  s.user = { userId, platformRole: "ceo", isSuperuser: true };
  s.agentInfo = { agentId, systemPrompt: "Independently inspect the synthetic research. Retain its evidence.", sensitivity: "internal" };
  s.run = { id: "run-row", taskRunId, userId, currentAgentId: agentId, threadId: "fixture-thread", contextId: "fixture-thread",
    title: parsed.title, objective: parsed.objective, status: "working", updatedAt: new Date(), authorityScope: parsed.authorityScope,
    progressPayload: { resumeReservedAt: fence.reservation, dispatch: { claimedAt: fence.dispatchClaim, count: 1, state: "claimed" } },
    a2aMetadata: { trigger: "external-mcp", requestDigest, initiativeReviewBinding: binding,
      sourceRef: { kind: "mcp-token", id: "fixture-token" }, authorityScope: parsed.authorityScope } };
  const item = { id: "item-row", itemId, title: "Synthetic research", organizationId: null, type: "product", source: "user-request",
    workType: "fix", scopeKind: "platform", parentId: null, parentEpicId: null, activeBuild: null, featureBuilds: [],
    archetypeCategories: [], archetypeIds: [] };
  const m = s.methods;
  m["taskRun.findUnique"] = m["taskRun.findFirst"] = ({ where }: Row) => matches(s.run, where) ? s.run : null;
  m["taskRun.updateMany"] = ({ where, data }: Row) => {
    if (!matches(s.run, where)) return { count: 0 };
    Object.assign(s.run, data, { updatedAt: new Date(s.run.updatedAt.getTime() + 1) }); return { count: 1 };
  };
  m["taskArtifact.findUnique"] = ({ where }: Row) => s.artifacts.find((a: Row) => matches(a, where)) ?? null;
  m["taskArtifact.findMany"] = (args: Row) => rows("artifacts", args);
  m["taskArtifact.create"] = ({ data }: Row) => {
    const event = data.parts?.[0]?.data?.event;
    if (s.failure === "post-writer" && data.name === "reassessment-effect-observed-v1" && event?.name === writer) {
      s.failure = null; throw new Error("Synthetic writer observation storage failure");
    }
    if (s.artifacts.some((a: Row) => a.artifactId === data.artifactId)) throw new Error("Duplicate capture open");
    s.log.push(data.name); return put("artifacts", data);
  };
  m["toolExecution.create"] = ({ data }: Row) => {
    if (s.failure === "before-provider" && data.toolName === "reassessment_capture" && data.parameters.event.kind === "provider")
      throw new Error("Synthetic pre-effect capture storage failure");
    s.log.push(`audit:${data.toolName}`); return put("executions", data);
  };
  m["toolExecution.findMany"] = (args: Row) => rows("executions", args);
  m["toolExecution.findFirst"] = (args: Row) => rows("executions", args).at(-1) ?? null;
  m["toolExecution.updateMany"] = ({ where, data }: Row) => { const found = rows("executions", { where }); found.forEach((r: Row) => Object.assign(r, data)); return { count: found.length }; };
  m["toolExecution.update"] = ({ where, data }: Row) => { const row = s.executions.find((r: Row) => r.id === where.id); Object.assign(row, data); return row; };
  m["backlogItem.findUnique"] = ({ where }: Row) => {
    if (s.receiptReadUnavailable && s.activities.length) throw new Error("Synthetic canonical readback unavailable");
    return matches(item, where) ? { ...item, activities: s.activities } : null;
  };
  m["backlogItemActivity.findMany"] = (args: Row) => rows("activities", args);
  m["backlogItemActivity.findUnique"] = ({ where }: Row) => s.activities.find((a: Row) => matches(a, where)) ?? null;
  m["backlogItemActivity.create"] = ({ data }: Row) => { s.log.push("canonical-receipt"); return put("activities", data); };
  m["coworkerActionEnvelope.findMany"] = () => [];
  m["authorizationDecisionLog.create"] = ({ data }: Row) => put("authorities", data);
  m["authorizationDecisionLog.findUnique"] = ({ where }: Row) => s.authorities.find((a: Row) => matches(a, where)) ?? null;
  m["principalAlias.findMany"] = ({ where }: Row) => [
    { aliasType: "email", aliasValue: "fixture-author@example.invalid", issuer: "", principalId: "PRN-AUTHOR" },
    { aliasType: "agent", aliasValue: agentId, issuer: "", principal: { principalId: s.samePrincipal ? "PRN-AUTHOR" : "PRN-REVIEWER" } },
  ].filter(alias => matches(alias, where));
  m["workroom.findMany"] = () => [{ capsuleId: "WC-FIXTURE", headBranch: "codex/fixture", headSha: commitSha,
    createdByPrincipalId: "PRN-AUTHOR", activities: [] }];
  m["modelProvider.findUnique"] = () => provider;
  m["modelProfile.findMany"] = () => [profile]; m["modelProfile.findUnique"] = () => profile;
  m["aiProviderConnection.findMany"] = () => [account]; m["aiProviderConnection.findUnique"] = () => account;
  m["agent.findUnique"] = m["agent.findFirst"] = () => agent;
  m["platformConfig.findUnique"] = () => null;
  m["buildStudioStallThreshold.findUnique"] = () => ({ heartbeatTimeoutSeconds: 60, totalPhaseTimeoutSeconds: 300 });
  m["platformDevConfig.findUnique"] = () => ({ upstreamRemoteUrl: "https://github.com/fixture/repository.git" });
  m["credentialEntry.findUnique"] = () => null;
  m["credentialEntry.findMany"] = () => []; m["credentialEntry.findFirst"] = () => null;
  m["scheduledJob.findFirst"] = () => null;
  m["tokenUsage.aggregate"] = () => ({ _sum: { inputTokens: 0, outputTokens: 0 } });
  for (const name of ["providerClearanceOverride", "policyRule", "endpointTaskPerformance", "providerCapacityStatus", "wikiPage", "mcpServerTool"]) m[`${name}.findMany`] = () => [];
  for (const name of ["executionRecipe", "decisionPerspectiveProfile"]) m[`${name}.findFirst`] = () => null;
  m["taskRequirement.findUnique"] = () => null; m["agentModelConfig.findUnique"] = () => null;
  for (const name of ["routeDecisionLog", "routeOutcome", "adapterRunTelemetry", "tokenUsage", "taskMessage", "coworkerTurnMetric"]) {
    m[`${name}.create`] = ({ data }: Row) => ({ id: `${name}-row`, ...data });
    m[`${name}.upsert`] = () => ({});
  }
}

async function prepare(gate: "research" | "design-spec" = "research") {
  writer = gate === "research" ? "record_initiative_evidence" : "record_initiative_design_review";
  Object.assign(binding, { writerToolName: writer, gate });
  grants.splice(0, grants.length, "file_read", "backlog_read", gate === "research" ? "initiative_evidence_write" : "initiative_design_review");
  parsed.authorityScope = [`backlog-item:${itemId}`, `tool:${reader}`, `tool:${writer}`, ...grants];
  installStorage();
  const tools = await resolveAutonomousWorkTools({ userContext: s.user, agentId, mode: "act", externalAccessEnabled: true,
    routeContext: parsed.routeContext, intentQuery: parsed.prompt, requiredToolNames: [reader, writer], restrictedReviewBinding: binding });
  const qualification = await qualifyReassessmentExecution({ messages: [{ role: "user", content: parsed.prompt }],
    systemPrompt: s.agentInfo.systemPrompt, sensitivity: "internal", options: { agentId, taskType: "external-mcp", tools: tools.toolsForProvider },
    effortWarrant: { maxIterations: 8, maxDurationMs: 30000 }, toolSurfaceDigest: reassessmentToolSurfaceDigest(tools.toolsForProvider) });
  const startedAt = new Date();
  const manifest = { schemaVersion: 1 as const, taskRunId, userId, agentId, requestDigest, executionFence: fence, binding, qualification,
    startedAt: startedAt.toISOString(), deadlineAt: new Date(startedAt.getTime() + 30000).toISOString() };
  const locator = { schemaVersion: 1, manifestArtifactId: "fixture-manifest", manifestDigest: reassessmentExecutionManifestDigest(manifest) };
  s.run.a2aMetadata.reassessmentExecution = locator;
  s.artifacts.push({ id: "manifest-row", artifactId: locator.manifestArtifactId, taskRunId: s.run.id, name: "fixture-manifest",
    parts: [{ type: "reassessment-execution-manifest-v1", data: manifest }] });
  s.log = [];
  return manifest;
}
function run() {
  return executeRemoteTaskAttempt({ run: { id: s.run.id, taskRunId, contextId: s.run.contextId }, threadId: s.run.threadId,
    token: { tokenId: "fixture-token", userId, capability: "write", source: "pat" }, userContext: s.user, parsed,
    idempotentReplay: false, capacityAttempt: 1, expectedReservation: fence.reservation, expectedDispatchClaim: fence.dispatchClaim });
}
const reservations = () => s.executions.filter((e: Row) => e.toolName === "reassessment_capture");
beforeEach(() => {
  Object.assign(s, { methods: {}, requests: [], providerEntries: 0, repoRequests: [], artifacts: [], executions: [], activities: [], authorities: [], log: [], locks: [],
    unconfigured: [], unsupported: [], unexpectedNetwork: [], failure: null, hidden: false, samePrincipal: false,
    decision: "pass", trailingTool: false, receiptReadUnavailable: false });
  installStorage(); invalidateRoutingLoaderCache();
  vi.stubGlobal("fetch", () => { s.unexpectedNetwork.push("global fetch"); throw new Error("Unexpected real network access"); });
  s.repoFetch = async (input: RequestInfo | URL) => {
    const url = String(input); s.repoRequests.push(url);
    if (url === `https://api.github.com/repos/fixture/repository/contents/research.md?ref=${commitSha}`)
      return new Response(JSON.stringify({ type: "file", encoding: "base64", content: Buffer.from(source).toString("base64"), sha: blobId, size: Buffer.byteLength(source) }));
    if (url === `https://api.github.com/repos/fixture/repository/commits/${commitSha}`)
      return new Response(JSON.stringify({ commit: { message: "Synthetic research\n\nSigned-off-by: Fixture Author <fixture-author@example.invalid>" } }));
    s.unexpectedNetwork.push(`repository:${url}`); throw new Error(`Unexpected repository transport: ${url}`);
  };
  s.providerFetch = async (input: RequestInfo | URL, init: RequestInit) => {
    s.providerEntries += 1;
    if (String(input) !== "https://provider.invalid/v1/chat/completions") {
      s.unexpectedNetwork.push(`provider:${String(input)}`); throw new Error("Unexpected provider transport");
    }
    expect(init.redirect).toBe("error"); expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init.body));
    expect(body.tools.map((t: Row) => t.function.name).sort()).toEqual([reader, writer].sort());
    expect(reservations().at(-1)?.parameters.event.kind).toBe("provider");
    s.requests.push(body); s.log.push("provider-io");
    const n = s.requests.length, name = s.hidden ? "load_tools" : n === 1 ? reader : n === 2 ? writer : null;
    const args = name === writer ? { decision: s.decision, reason: "The synthetic model supplies this fixture assessment.",
      findings: s.decision === "fail" ? [{ issue: "Synthetic blocking finding about the stated boundary.", severity: "important",
        evidence: { blobId, startLine: 2, endLine: 2, quote: "The ownership and capture boundaries are explicit." } }] : [], resolvedFindingRefs: [] } : {};
    const toolCalls = name ? [{ id: `call-${n}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] : [];
    if (name === writer && s.trailingTool) toolCalls.push({ id: "trailing-reader", type: "function", function: { name: reader, arguments: "{}" } });
    return new Response(JSON.stringify({ choices: [{ finish_reason: name ? "tool_calls" : "stop", message: { content: name ? "" : "Research recorded.",
      ...(name ? { tool_calls: toolCalls } : {}) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
  };
  _setGovernanceForTests({ resolveCoworkerAuthorityInput: authorityInput as never });
});
afterEach(() => {
  _setGovernanceForTests({}); vi.unstubAllGlobals(); vi.restoreAllMocks();
  expect([...new Set(s.unconfigured)]).toEqual([]); expect(s.unsupported).toEqual([]); expect(s.unexpectedNetwork).toEqual([]);
});

describe("connected persisted R2 execution with synthetic exterior ports", () => {
  it("runs real worker, capture, routing, loop and governed research handlers through canonical receipt readback", async () => {
    const manifest = await prepare();
    const result = await run();
    expect(result).toMatchObject({ kind: "result", result: { status: "completed", isError: false } });
    const receipt = s.activities.find((a: Row) => a.kind === "initiative_gate_receipt");
    expect(receipt?.payload).toMatchObject({ gate: "research", decision: "pass", artifactRef });
    expect(s.run.progressPayload.reviewOutcome.receiptId).toBe(receipt.id);
    expect(s.artifacts.filter((a: Row) => a.name === "reassessment-execution-open-v1")).toHaveLength(1);
    expect(s.artifacts.filter((a: Row) => a.name === "reassessment-execution-close-v1")).toHaveLength(1);
    expect(s.requests).toHaveLength(2);
    expect(s.providerEntries).toBe(2);
    expect(s.requests[1].messages.some((m: Row) => m.role === "tool" && m.content.includes("The ownership and capture boundaries are explicit."))).toBe(true);
    expect(s.repoRequests.length).toBeGreaterThanOrEqual(3);
    for (const execution of reservations()) {
      expect(execution).toMatchObject({ taskRunId, userId, agentId, success: true });
      expect(execution.parameters.executionFence).toEqual(fence);
    }
    expect(s.run.progressPayload.resumeReservedAt).toBe(fence.reservation);
    expect(s.run.progressPayload.dispatch.claimedAt).toBe(fence.dispatchClaim);
    expect(manifest.qualification.budgetConfiguration.configuredPerTaskLimit).toBe(0);
    expect(s.log.indexOf("reassessment-execution-open-v1")).toBeLessThan(s.log.indexOf("provider-io"));
  });
  it("refuses a provider-proposed hidden tool before registry dispatch", async () => {
    await prepare(); s.hidden = true; await run();
    expect(s.providerEntries).toBe(1);
    expect(s.requests).toHaveLength(1); expect(s.repoRequests).toHaveLength(0); expect(s.activities).toHaveLength(0);
    expect(s.executions.some((e: Row) => e.toolName === "load_tools")).toBe(false);
  });
  it("publishes a task-bound independent design receipt through the actual governed writer", async () => {
    await prepare("design-spec");
    expect(await run()).toMatchObject({ result: { status: "completed", isError: false } });
    const [receipt] = s.activities;
    expect(s.activities).toHaveLength(1);
    expect(receipt.id).toMatch(/^initiative-review-v1-[a-f0-9]{64}$/);
    expect(receipt.payload).toMatchObject({ gate: "design-spec", decision: "pass", artifactRef,
      reviewerPrincipalId: "PRN-REVIEWER", reviewerAgentId: agentId, artifactAuthorRef: "principal:PRN-AUTHOR|agent:null" });
    expect(s.run.progressPayload.reviewOutcome.receiptId).toBe(receipt.id);
    expect(s.locks).toContain('SELECT "id" FROM "TaskRun" WHERE "taskRunId" = ? FOR SHARE');
    expect(s.authorities.find((a: Row) => a.decisionId === receipt.payload.authorityDecisionId)?.rationale.taskRunId).toBe(taskRunId);
    expect(s.requests).toHaveLength(2);
    expect(s.providerEntries).toBe(2);
  });
  it.each(["research", "design-spec"] as const)("stops on an actual canonical %s fail before a trailing governed reader or generation", async gate => {
    await prepare(gate); s.decision = "fail"; s.trailingTool = true;
    expect(await run()).toMatchObject({ result: { status: "completed", isError: false } });
    expect(s.activities).toHaveLength(1);
    expect(s.activities[0].payload).toMatchObject({ gate, decision: "fail", artifactRef });
    expect(s.run.progressPayload.reviewOutcome).toMatchObject({ receiptId: s.activities[0].id, decision: "fail" });
    // The actual pack re-reads the citation through its governed dispatcher.
    expect(s.executions.filter((e: Row) => e.toolName === reader)).toHaveLength(2);
    expect(s.log.lastIndexOf(`audit:${reader}`)).toBeLessThan(s.log.indexOf("canonical-receipt"));
    expect(s.requests).toHaveLength(2); expect(s.providerEntries).toBe(2);
  });
  it("holds unavailable canonical readback after an actual writer commit without another provider start", async () => {
    await prepare("design-spec"); s.receiptReadUnavailable = true;
    expect(await run()).toMatchObject({ result: { status: "input-required", waitReason: "execution-uncertain", resumable: false } });
    expect(s.activities).toHaveLength(1); expect(s.run.progressPayload).not.toHaveProperty("reviewOutcome");
    expect(s.requests).toHaveLength(2); expect(s.providerEntries).toBe(2);
  });
  it("refuses self-review in the real independent design writer without a canonical append", async () => {
    await prepare("design-spec"); s.samePrincipal = true;
    expect(await run()).toMatchObject({ result: { status: "input-required" } });
    expect(s.activities).toHaveLength(0);
    expect(s.executions.find((e: Row) => e.toolName === writer)?.result).toMatchObject({ success: false, error: "reviewer-not-independent" });
  });
  it("starts no provider when its pre-effect capture cannot persist", async () => {
    await prepare(); s.failure = "before-provider"; await run();
    expect(s.providerEntries).toBe(0);
    expect(s.requests).toHaveLength(0); expect(s.repoRequests).toHaveLength(0); expect(s.activities).toHaveLength(0);
  });
  it.each(["research", "design-spec"] as const)("reconciles the actual canonical %s receipt after writer observation failure without another provider call", async gate => {
    await prepare(gate); s.failure = "post-writer";
    expect(await run()).toMatchObject({ result: { status: "completed", isError: false } });
    expect(s.requests).toHaveLength(2);
    expect(s.providerEntries).toBe(2);
    expect(s.activities.filter((a: Row) => a.kind === "initiative_gate_receipt")).toHaveLength(1);
    expect(s.artifacts.some((a: Row) => a.name === "reassessment-effect-uncertain-v1")).toBe(true);
    expect(s.run.progressPayload.reviewOutcome.receiptId).toBe(s.activities[0].id);
  });
});
