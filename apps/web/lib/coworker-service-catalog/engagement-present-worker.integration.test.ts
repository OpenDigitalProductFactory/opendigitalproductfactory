import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import metadata from "../inference/fixtures/reassessment-native-model.json";
import { reassessmentBudgetFixture } from "../../test-support/reassessment-budget-fixture";
import { ENGAGEMENT_NATIVE_COMPOSITION as catalog } from "../shared/engagement-native-composition";
import { parseEngagementTaskBinding } from "./engagement-task-binding";
import { withEngagementPresentRequest, currentEngagementPresentAssessment, prepareEngagementPresentAdmission,
  activateEngagementPresentAdmission, assertEngagementPresentAssociation, reconcileEngagementPresentObservation, readOutstandingEngagementReservations, readEngagementPresentConfiguration } from "./engagement-present-assessment";
import { executeEngagementPresentAttempt, type EngagementPresentPorts } from "./engagement-present-worker";
import { persistEngagementRead } from "./engagement-read-provenance";
import type { RemoteTaskAttemptInput } from "../mcp-task-submit-types";

// These are synthetic boundary ports, never an installed provider or authority.
// Production ALS, admission hooks, worker, capture/parser, provenance, visual
// receipt, contribution validation and settlement all execute unchanged.
// Actual PostgreSQL locking/rollback/races are covered in the separate SQL suite.
type Row = Record<string, any>;
const m = vi.hoisted(() => ({ db: {} as Row, rows: {} as Record<string, Row[]>, budget: {} as Row,
  allowed: true, scenario: "valid", fetch: vi.fn(), reads: [] as string[], bodies: [] as string[],
  sends: [] as string[], failSettlement: false, sequence: 0, visual: {} as Row }));
vi.mock("@dpf/db", () => ({ prisma: new Proxy({}, { get: (_target, key) => m.db[String(key)] }) }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: async () => ({ userId: "fixture-owner", platformRole: "ceo", isSuperuser: true }) }));
vi.mock("@/lib/permissions", () => ({ can: () => true }));
vi.mock("@/lib/govern/authority/resolve-coworker-tool-authority", () => ({ resolveCoworkerToolAuthorityInput: async (input: Row) => ({ ...input, ...(input.execution.context.approvedAuthorityEnvelopeId ? { approval: { envelopeId: input.execution.context.approvedAuthorityEnvelopeId } } : {}) }) }));
vi.mock("@/lib/govern/authority/coworker-authority-decision", () => ({ evaluateCoworkerAuthority: (input: Row) => ({ outcome: m.allowed && input.agentGrantAllowed ? "allow" : "deny" }) }));
vi.mock("@/lib/mcp/packs/coworker-service-catalog-pack", () => ({ coworkerServiceCatalogPack: { definitions: [{ name: "request_coworker_engagement" }] } }));
vi.mock("@/lib/tak/agent-grants", () => ({ expandGrants: () => ["fixture"], persistedAgentToolGrants: () => ["fixture"], isToolAllowedByGrants: (name: string) => name === "request_coworker_engagement" }));
vi.mock("@/lib/inference/local-model-management", () => ({ canonicalLocalModelKey: (value: string) => value }));
vi.mock("@/lib/inference/budget-gate", async load => ({ ...await load<typeof import("../inference/budget-gate")>(), readReassessmentBudgetConfiguration: async () => m.budget }));
vi.mock("./engagement-fulfillment", async load => ({ ...await load<typeof import("./engagement-fulfillment")>(),
  validateEngagementTask: async (input: Row) => { await assertEngagementPresentAssociation({ ...input, db: input.db ?? m.db } as never); return { visualEvidence: m.visual }; } }));
vi.mock("@/lib/network/off-threadpool-fetch", () => ({ createOffThreadpoolFetchTransport: () => ({ fetch: m.fetch, close: async () => {} }) }));
vi.mock("@/lib/inference/data-screening/routed-screening", () => ({ createRoutedInferenceScreen: (input: Row) => ({
  screenInput: input, screen: { receipt: { routeEffect: "allow" }, routeContext: input.routeContext } }) }));
vi.mock("@/lib/inference/host-gpu-admission", () => ({ readPublishedHostGpuObservation: async () => ({ observedAtMs: 1, snapshot: { memoryTotalMiB: 64000, memoryUsedMiB: 0 } }),
  parseEngineRunners: (value: unknown) => value, requiredLocalModelMiB: () => 1, decideLocalGpuAdmission: () => ({ defer: null }) }));
vi.mock("@/lib/queue/resource-lane", () => ({ withLocalInferenceLock: async (execute: () => Promise<unknown>, options: Row) => { await options.capturedCapacityProbe(); return execute(); } }));
vi.mock("@/lib/inference/routed-inference", () => ({ prepareReassessmentNativeStaticRoute: async () => ({
  manifests: [{ id: "fixture-endpoint", providerId: "local", modelId: catalog.logicalModelRef }],
  decision: { selectedEndpoint: "fixture-endpoint", executionPlan: { providerConnectionId: "provider-default-local" } }, contract: { fixture: true } }) }));

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const blob = (value: string) => createHash("sha1").update(`blob ${Buffer.byteLength(value)}\0`).update(value).digest("hex");
const prototype = "<html><style>.x{color:red}</style><body><button>Inspect reason</button></body><script>code()</script></html>\n";
const guidance = "Full pinned synthetic UX guidance.\n";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHNcAAAAASUVORK5CYII=";
const base = { kind: "repo-blob-at-commit" as const, repositoryFullName: "fixture/repo", commitSha: "b".repeat(40) };
const binding = parseEngagementTaskBinding({ version: 1, engagementId: "CE-1FE20783", offerId: "fixture-offer", serviceId: "svc-ux-design-critique",
  providerAgentId: "ux-design-critic", actorAgentId: "AGT-EXT-CODEX", userId: "fixture-owner", workroomId: "WC-FIXTURE", stageKey: "accept", inputDigest: "a".repeat(64),
  artifactRef: { ...base, path: "prototype.html", providerBlobId: blob(prototype) }, roomHeadSha: base.commitSha,
  guidanceArtifacts: [{ ...base, path: "docs/professions/ux-design/wiki/heuristic.md", providerBlobId: blob(guidance) }],
  visualEvidenceRef: { kind: "document-version", repositoryFullName: base.repositoryFullName, versionId: "fixture-images", valueDigest: "d".repeat(64) } })!;
const token = { tokenId: "fixture-token", userId: binding.userId, source: "oauth" as const, capability: "write" as const };
const request = { engagementId: binding.engagementId, userId: binding.userId, token, rawParams: { engagementId: binding.engagementId, fulfillment: { presentAssessment: true } },
  context: { agentId: binding.actorAgentId, authorityDecisionId: "fixture-native-decision", userContext: { userId: binding.userId, platformRole: "ceo", isSuperuser: true } } };
const answer = () => ({ summary: "Synthetic advisory critique", criteria: ["Information hierarchy"], corpusRefs: ["professions/ux-design/heuristic"],
  findings: [{ severity: "medium", criterion: "Information hierarchy", observation: "Reason is hidden.", evidence: "Synthetic default capture.", proposedCorrection: "Expose the selected decision reason.", captureState: "default" }],
  limitations: ["Synthetic immutable source and one image only."], reviewedArtifacts: ["prototype.html@" + base.commitSha], calibrationLimitations: ["Empty calibrated corpus; advisory."] });
const reply = () => ({ id: "fixture-reply", type: "message", role: "assistant", model: m.scenario === "wrong-model" ? "unrelated-model" : catalog.modelDigest,
  content: [{ type: "tool_use", id: "answer", name: "return_ux_critique", input: answer() }], stop_reason: "tool_use", stop_sequence: null,
  usage: { input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 200 } });

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return (value as Row[]).every(v => matches(row, v));
    if (key === "OR") return (value as Row[]).some(v => matches(row, v));
    if (value && typeof value === "object") {
      if ("in" in value) return value.in.includes(row[key]);
      if ("path" in value) return value.path.reduce((at: Row, part: string) => at?.[part], row[key]) === value.equals;
      if ("gte" in value) return true; // all synthetic usage belongs to this test's current day
    }
    return row[key] === value;
  });
}
function memoryDatabase() {
  const table = (name: string) => ({
    findUnique: async ({ where }: Row) => structuredClone(m.rows[name].find(row => matches(row, where)) ?? null),
    findMany: async ({ where, take }: Row = {}) => structuredClone(m.rows[name].filter(row => matches(row, where)).slice(0, take)),
    create: async ({ data }: Row) => {
      if (name === "tokenUsage" && m.failSettlement) throw new Error("synthetic-settlement-refused");
      const row = { id: `fixture-${++m.sequence}`, ...structuredClone(data) };
      if (name === "taskArtifact" && m.rows[name].some(r => r.artifactId === row.artifactId)) throw new Error("synthetic-unique-artifact");
      m.rows[name].push(row); return structuredClone(row);
    },
    update: async ({ where, data }: Row) => { const at = m.rows[name].findIndex(row => matches(row, where)); if (at < 0) throw new Error(`missing-synthetic-${name}`);
      m.rows[name][at] = { ...m.rows[name][at], ...structuredClone(data) }; return structuredClone(m.rows[name][at]); },
    aggregate: async () => ({ _sum: { inputTokens: m.rows[name].reduce((n, row) => n + (row.inputTokens ?? 0), 0), outputTokens: m.rows[name].reduce((n, row) => n + (row.outputTokens ?? 0), 0) } }),
  });
  m.rows = Object.fromEntries(["taskRun", "coworkerEngagement", "taskArtifact", "taskMessage", "toolExecution", "tokenUsage", "workroomActivity", "workroom",
    "agent", "agentModelConfig", "modelProvider", "aiProviderConnection", "modelProfile", "authorizationDecisionLog", "mcpApiToken", "coworkerActionEnvelope"].map(name => [name, []]));
  m.db = Object.fromEntries(Object.keys(m.rows).map(name => [name, table(name)]));
  m.db.$queryRaw = async () => [];
  m.db.$transaction = async (execute: (tx: Row) => Promise<unknown>) => { const prior = structuredClone(m.rows); try { return await execute(m.db); } catch (error) { m.rows = prior; throw error; } };
}
beforeEach(() => {
  vi.clearAllMocks(); memoryDatabase(); m.allowed = true; m.scenario = "valid"; m.failSettlement = false; m.sequence = 0; m.reads = []; m.bodies = []; m.sends = [];
  m.budget = reassessmentBudgetFixture({ agentId: binding.providerAgentId, registryAgentId: "AGT-906", configuredPerTaskLimit: 20000, configuredDailyLimit: 200000,
    configuredTimeoutMs: 180000, configuredMaxOutputTokens: 8192 });
  m.rows.taskRun.push({ id: "original-row", taskRunId: "TR-MCP-original", userId: binding.userId, status: "input-required",
    progressPayload: { dispatch: { claimedAt: "held-original" }, executionUncertainty: { settlement: "unknown" } },
    a2aMetadata: { engagementBinding: binding, requestDigest: "e".repeat(64), unknownSpend: "UNKNOWN" } });
  m.rows.coworkerEngagement.push({ id: "engagement-row", engagementId: binding.engagementId, requestedByUserId: binding.userId, requestedByAgentId: binding.actorAgentId,
    status: "unavailable", metadata: { fulfillment: { binding, taskRunId: "TR-MCP-original", state: "unavailable" }, originalConsumption: "UNKNOWN" } });
  m.rows.workroom.push({ id: "room-row", capsuleId: binding.workroomId });
  m.rows.agent.push({ id: "actor-row", agentId: binding.actorAgentId, status: "active", archived: false, toolGrants: [], toolGrantRevocations: [] });
  m.rows.agentModelConfig.push({ agentId: binding.providerAgentId, minimumTier: "strong", minimumContextTokens: 16000, minimumCapabilities: null });
  m.rows.modelProvider.push({ providerId: "local", status: "active", retiredAt: null, supportsToolUse: true, baseUrl: "http://synthetic.invalid/engines/v1" });
  m.rows.aiProviderConnection.push({ connectionId: "provider-default-local", providerId: "local", status: "active", executionChannel: "local-runtime", authMethod: "local", credentialEntryId: null });
  m.rows.modelProfile.push({ providerId: "local", modelId: catalog.logicalModelRef, modelStatus: "active", retiredAt: null, qualityTier: "strong", supportsToolUse: true, capabilities: { imageInput: null }, maxOutputTokens: 2048 });
  m.rows.authorizationDecisionLog.push({ decisionId: "fixture-native-decision", actionKey: "request_coworker_engagement", humanContextRef: binding.userId,
    agentContextRef: binding.actorAgentId, decision: "allow", authorityBindingId: "fixture-delegation" });
  m.rows.mcpApiToken.push({ id: token.tokenId, authorityBindingId: "fixture-delegation" });
  m.visual = { inputs: [{ type: "image_url", image_url: { url: `data:image/png;base64,${png}` } }], provenance: { manifestRef: binding.visualEvidenceRef,
    captures: [{ state: "default", sha256: sha(Buffer.from(png, "base64")) }], limitations: ["Synthetic capture"], url: "https://fixture.invalid/prototype" } };
  m.fetch.mockImplementation(async (url: string, init: RequestInit) => {
    m.sends.push(url); if (init.body) m.bodies.push(String(init.body));
    let value: unknown;
    if (url.endsWith("/version")) value = { version: catalog.runtimeVersion };
    else if (url.endsWith("/engines/status")) value = { "llama.cpp": `Running: llama.cpp ${catalog.engineBuild} (sha256:${catalog.engineArchiveDigest}) ${catalog.engineSourceCommit.slice(0, 7)}` };
    else if (url.includes("/engines/_configure?")) value = [{ Backend: "llama.cpp", Mode: "completion", Model: catalog.logicalModelRef, ModelID: catalog.modelDigest, Config: { "context-size": 40960, "runtime-flags": ["--spec-type", "ngram-mod"], keep_alive: "-1" } }];
    else if (url.includes("/models/")) value = { ...structuredClone(metadata), id: catalog.modelDigest };
    else if (url.endsWith("/engines/ps")) value = [];
    else if (url.endsWith("/count_tokens")) { value = { input_tokens: 100 }; if (m.scenario === "deny-after-count") m.allowed = false;
      const envelope = m.rows.coworkerActionEnvelope[0];
      if (m.scenario === "envelope-resolved") envelope.resolvedAt = new Date(envelope.resolvedAt.getTime() + 1);
      if (m.scenario === "envelope-expired") envelope.expiresAt = new Date(Date.now() - 1);
      if (m.scenario === "envelope-cancelled") envelope.status = "cancelled";
      if (m.scenario === "envelope-executed") envelope.status = "executed";
      if (m.scenario === "envelope-foreign") envelope.delegatingUserId = "different-fixture-owner"; }
    else if (url.endsWith("/messages")) {
      if (m.scenario === "lost-ack") throw new Error("Synthetic generation acknowledgement lost");
      value = reply();
      if (m.scenario === "expire-after-response") currentEngagementPresentAssessment()!.deadlineAt = new Date(Date.now() - 1).toISOString();
      if (m.scenario === "fence-after-response") m.rows.taskRun.find(row => row.taskRunId === "TR-MCP-present")!.progressPayload.dispatch = { claimedAt: "another-generation" };
    } else throw new Error(`Unexpected synthetic effect ${url}`);
    return new Response(JSON.stringify(value), { status: 200 });
  });
});

const ports: EngagementPresentPorts = {
  prepareTurn: async () => ({ resolvedAgentId: "AGT-906", conversation: { systemPrompt: "Synthetic registered UX Critic persona" }, agent: { sensitivity: "internal" }, modelRequirements: {} }) as never,
  executeRead: async ({ toolName, args, agentId, fence }, attempt) => {
    m.reads.push(toolName); let data: Row;
    if (toolName === "read_source_at_version") { const content = args.path === "prototype.html" ? prototype : guidance;
      data = { repositoryFullName: base.repositoryFullName, version: base.commitSha, path: args.path, blobId: args.expectedBlobId,
        content, totalChars: content.length, startLine: 1, endLine: 1, totalLines: 1, hasMore: false, nextCursor: null }; }
    else if (toolName === "wiki_query") data = { retrievalMode: "lexical", results: [{ slug: "professions/ux-design/heuristic", contentPreview: "Synthetic information hierarchy criterion." }] };
    else data = { calibratedOnly: true, total: 0, grounding: "UNGROUNDED" };
    const result = { success: true, message: "Synthetic governed read", data };
    const audit = await m.db.toolExecution.create({ data: { taskRunId: attempt.run.taskRunId, userId: token.userId, agentId, toolName, parameters: args, result, success: true } });
    await persistEngagementRead({ taskRunId: attempt.run.taskRunId, userId: token.userId, agentId, executionId: audit.id, toolName, args, result, fence });
    return result;
  },
};
async function runAssessment(approvedAuthorityEnvelopeId?: string) {
  const governedRequest = { ...request, context: { ...request.context, ...(approvedAuthorityEnvelopeId ? { approvedAuthorityEnvelopeId } : {}) } };
  return withEngagementPresentRequest(governedRequest as never, async present => {
    const input = { taskRunId: "TR-MCP-present", requestDigest: "f".repeat(64), threadId: "fixture-thread", token,
      parsed: { agentId: binding.providerAgentId, routeContext: "/fixture", title: "Synthetic assessment", objective: "Synthetic original scope", prompt: "Review the exact synthetic source and image.",
        riskClass: "read" as const, idempotencyKey: "synthetic-one-candidate", engagementBinding: present, authorityScope: [] } };
    const hooks = await prepareEngagementPresentAdmission(input as never);
    const run = await m.db.$transaction(async (tx: Row) => {
      await hooks.admissionGuard(tx as never);
      const created = await tx.taskRun.create({ data: { taskRunId: input.taskRunId, userId: token.userId, currentAgentId: binding.providerAgentId,
        status: "working", contextId: input.threadId, a2aMetadata: { engagementBinding: present, requestDigest: input.requestDigest } } });
      await hooks.afterTaskCreated(tx as never, created); return created;
    });
    activateEngagementPresentAdmission(input.taskRunId);
    const attempt = { ...input, run, userContext: request.context.userContext, idempotentReplay: false, capacityAttempt: 0 } as RemoteTaskAttemptInput;
    const result = await executeEngagementPresentAttempt(attempt, ports);
    const before = m.sends.length;
    await expect(executeEngagementPresentAttempt(attempt, ports)).resolves.toMatchObject({ result: { isError: true, resumable: false } });
    expect(m.sends).toHaveLength(before);
    return result;
  });
}
afterEach(() => {
  expect(m.rows.taskRun.find(row => row.taskRunId === "TR-MCP-original")).toMatchObject({ status: "input-required",
    progressPayload: { executionUncertainty: { settlement: "unknown" } }, a2aMetadata: { unknownSpend: "UNKNOWN", engagementBinding: binding } });
  expect(engagement().metadata.fulfillment).toEqual({ binding, taskRunId: "TR-MCP-original", state: "unavailable" });
});
const generations = () => m.sends.filter(url => url.endsWith("/messages"));
const retained = () => m.rows.taskArtifact.flatMap(row => row.parts).map(part => part.data);
const engagement = () => m.rows.coworkerEngagement[0];

describe("canonical local account configuration", () => {
  it("accepts the canonical local account without allocating or contacting a provider", async () => {
    await expect(readEngagementPresentConfiguration(binding.providerAgentId)).resolves.toMatchObject({
      modelId: catalog.logicalModelRef, budget: { registryAgentId: "AGT-906" } });
    expect(m.sends).toHaveLength(0); expect(m.rows.taskRun).toHaveLength(1);
    expect(engagement().metadata.presentAssessment).toBeUndefined();
  });
  it.each([
    ["legacy no-auth marker", "authMethod", "none", "native-configuration-unavailable"],
    ["paused account", "status", "paused", "local-account-paused: Resume the existing provider-default-local account using supported account controls"],
    ["foreign execution channel", "executionChannel", "direct-api", "native-configuration-unavailable"],
    ["credentialed account", "credentialEntryId", "foreign-credential", "native-configuration-unavailable"],
  ])("refuses %s before allocation or provider starts", async (_label, field, value, reason) => {
    m.rows.aiProviderConnection[0][field] = value;
    await expect(readEngagementPresentConfiguration(binding.providerAgentId)).rejects.toThrow(reason);
    expect(m.sends).toHaveLength(0); expect(m.rows.taskRun).toHaveLength(1);
    expect(engagement().metadata.presentAssessment).toBeUndefined(); expect(m.rows.tokenUsage).toHaveLength(0);
  });
  it("preserves an inactive provider and names its supported remedy", async () => {
    m.rows.modelProvider[0].status = "inactive";
    await expect(readEngagementPresentConfiguration(binding.providerAgentId)).rejects.toThrow("local-provider-inactive: Enable the existing local provider using supported account controls");
    expect(m.rows.modelProvider[0].status).toBe("inactive"); expect(m.sends).toHaveLength(0);
    expect(m.rows.taskRun).toHaveLength(1); expect(engagement().metadata.presentAssessment).toBeUndefined();
  });
});

describe("actual admitted finite Critic worker with synthetic external boundaries", () => {
  it("counts the exact image body once and atomically returns the attributable advisory result and usage", async () => {
    const original = structuredClone(m.rows.taskRun[0]);
    await expect(runAssessment()).resolves.toMatchObject({ result: { status: "completed", isError: false, structuredContent: {
      engagementId: binding.engagementId, providerAgentId: binding.providerAgentId, advisoryOnly: true, authorDisposition: "pending", actualUsage: { inputTokens: 100, outputTokens: 200 } } } });
    expect(generations()).toHaveLength(1); expect(m.bodies).toHaveLength(2); expect(m.bodies[0]).toBe(m.bodies[1]); expect(m.bodies[0]).toContain(png);
    expect(m.reads).toEqual(["read_source_at_version", "read_source_at_version", "wiki_query", "search_ux_critique_corpus"]);
    expect(m.rows.taskRun[0]).toEqual(original); expect(m.rows.tokenUsage).toHaveLength(1);
    expect(m.rows.tokenUsage[0]).toMatchObject({ agentId: "AGT-906", inputTokens: 100, outputTokens: 200 });
    expect(engagement().metadata.result).toMatchObject({ executionRef: m.rows.tokenUsage[0].traceId, calibrationLimitations: [expect.stringContaining("UNGROUNDED")],
      originalExecution: { historicalConsumption: "UNKNOWN", replayed: false }, sourceExecutionIds: expect.any(Array), corpusExecutionIds: expect.any(Array) });
    expect(m.rows.taskArtifact.some(row => row.artifactId === engagement().metadata.result.resultArtifactId)).toBe(true);
    expect(m.rows.workroomActivity).toHaveLength(1);
    expect(m.rows.workroomActivity[0]).toMatchObject({ workCapsuleId: "room-row", recordedByAgentId: "AGT-906",
      payload: { engagementId: binding.engagementId, taskRunId: "TR-MCP-present", executionRef: m.rows.tokenUsage[0].traceId, result: engagement().metadata.result } });
    const before = m.sends.length; await reconcileEngagementPresentObservation(binding.engagementId, m.db as never); expect(m.sends).toHaveLength(before);
    await expect(runAssessment()).rejects.toThrow("already-allocated"); expect(m.sends).toHaveLength(before);
  });
  it("retains the first wrong-model reply and exact predicate without a contribution, usage or retry", async () => {
    m.scenario = "wrong-model"; const result = await runAssessment();
    expect(result).toMatchObject({ result: { isError: true, resumable: false } }); expect(generations()).toHaveLength(1);
    expect(retained().some(data => String(data?.bodyText).includes("unrelated-model"))).toBe(true);
    expect(engagement().metadata.presentAssessment).toMatchObject({ state: "held", reason: expect.stringContaining("model"), resumable: false });
    expect(engagement().metadata.result).toBeUndefined(); expect(m.rows.tokenUsage).toHaveLength(0); expect(m.rows.workroomActivity).toHaveLength(0);
  });
  it("honors a current DENY between count and generation without sending generation", async () => {
    m.scenario = "deny-after-count"; await expect(runAssessment()).resolves.toMatchObject({ result: { isError: true } });
    expect(m.sends.some(url => url.endsWith("/count_tokens"))).toBe(true); expect(generations()).toHaveLength(0);
    expect(m.rows.tokenUsage).toHaveLength(0); expect(engagement().metadata.result).toBeUndefined();
  });
  it.each(["expire-after-response", "fence-after-response"])("retains the observed reply but refuses publication after %s", async scenario => {
    m.scenario = scenario; await expect(runAssessment()).resolves.toMatchObject({ result: { isError: true } });
    expect(generations()).toHaveLength(1); expect(retained().some(data => String(data?.bodyText).includes("fixture-reply"))).toBe(true);
    expect(engagement().metadata.result).toBeUndefined(); expect(m.rows.tokenUsage).toHaveLength(0); expect(m.rows.workroomActivity).toHaveLength(0);
    if (scenario === "fence-after-response") expect(m.rows.taskRun.find(row => row.taskRunId === "TR-MCP-present")?.progressPayload.dispatch.claimedAt).toBe("another-generation");
  });
  it("rolls back result/usage/return together when settlement fails while retaining the captured reply", async () => {
    m.failSettlement = true; await expect(runAssessment()).resolves.toMatchObject({ result: { isError: true } });
    expect(retained().some(data => String(data?.bodyText).includes("fixture-reply"))).toBe(true);
    expect(engagement().metadata.result).toBeUndefined(); expect(m.rows.tokenUsage).toHaveLength(0); expect(m.rows.workroomActivity).toHaveLength(0);
    expect(retained().some(data => data?.assessmentRelation === "separate-present-assessment")).toBe(false);
  });
  function approvedReservation() {
    m.rows.authorizationDecisionLog[0].decision = "require-approval";
    m.rows.coworkerActionEnvelope.push({ id: "fixture-envelope", status: "approved", resolvedAt: new Date(), expiresAt: new Date(Date.now() + 600000),
      delegatingUserId: binding.userId, coworkerAgentId: binding.actorAgentId, manifestActionId: "request_coworker_engagement" });
    return "fixture-envelope";
  }
  it("uses the actual still-approved reservation only within its original governed handler", async () => {
    const envelopeId = approvedReservation(); const reservedAt = m.rows.coworkerActionEnvelope[0].resolvedAt.toISOString();
    await expect(runAssessment(envelopeId)).resolves.toMatchObject({ result: { status: "completed", isError: false } });
    expect(m.rows.coworkerActionEnvelope[0]).toMatchObject({ status: "approved", resolvedAt: new Date(reservedAt) });
    expect(generations()).toHaveLength(1); expect(m.rows.tokenUsage).toHaveLength(1);
  });
  it.each(["resolved", "expired", "cancelled", "executed", "foreign"])("stops the next effect when the reserved envelope becomes %s", async change => {
    const envelopeId = approvedReservation(); m.scenario = `envelope-${change}`;
    await expect(runAssessment(envelopeId)).resolves.toMatchObject({ result: { isError: true } });
    expect(m.sends.some(url => url.endsWith("/count_tokens"))).toBe(true); expect(generations()).toHaveLength(0);
    expect(engagement().metadata.presentAssessment).toMatchObject({ state: "held", reason: expect.stringContaining("reservation-changed") });
    expect(m.rows.tokenUsage).toHaveLength(0); expect(engagement().metadata.result).toBeUndefined();
  });
  it("retains an UNKNOWN generation upper bound after a lost acknowledgement and refuses another send", async () => {
    m.scenario = "lost-ack";
    await expect(runAssessment()).resolves.toMatchObject({ result: { isError: true, resumable: false } });
    expect(generations()).toHaveLength(1);
    await expect(readOutstandingEngagementReservations(m.db as never, "AGT-906")).resolves.toEqual({ reservationCount: 1, reservedTokens: 2148 });
    expect(retained().some(data => data?.consumption === "UNKNOWN-with-reserved-upper-bound" && data?.partialBodyBytes === 0)).toBe(true);
    expect(m.rows.tokenUsage).toHaveLength(0); expect(engagement().metadata.result).toBeUndefined();
    const before = m.sends.length; await expect(runAssessment()).rejects.toThrow("already-allocated"); expect(m.sends).toHaveLength(before);
  });
});
