import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GOLDEN_CASES } from "@/lib/routing/tool-fidelity-harness";
import { runLocalToolFidelityDiagnostic } from "./tool-fidelity-runner";
import type { ToolExecutionContext } from "@/lib/mcp-tool-types";
import { accountExecutionVersion } from "@/lib/routing/provider-account-candidates";

const mocks = vi.hoisted(() => ({ call: vi.fn(), manifests: vi.fn(), tools: vi.fn(), version: vi.fn(),
  proof: vi.fn(), create: vi.fn(), update: vi.fn(), audit: vi.fn(), provider: vi.fn(), grants: vi.fn(),
  account: vi.fn(), budget: vi.fn(), budgetEvent: vi.fn(), executeAdapter: vi.fn(), admit: vi.fn() }));
vi.mock("@/lib/ai-inference", () => ({ callProvider: mocks.call }));
vi.mock("@/lib/routing/loader", () => ({ loadEndpointManifests: mocks.manifests, invalidateRoutingLoaderCache: vi.fn() }));
vi.mock("@/lib/platform/version", () => ({ loadPlatformVersion: mocks.version }));
vi.mock("@/lib/inference/dmr-runtime-config", () => ({ getLocalThinkingBudgetEvidence: mocks.proof }));
vi.mock("@/lib/agent-grants", () => ({ isToolAllowedByGrants: mocks.grants }));
vi.mock("@dpf/db", () => ({ prisma: { endpointTestRun: { create: mocks.create, update: mocks.update },
  toolExecution: { findUnique: mocks.audit }, modelProvider: { findUnique: mocks.provider },
  aiProviderConnection: { findUnique: mocks.account } } }));
vi.mock("@/lib/inference/budget-gate", () => ({ checkAgentBudgetFromRegistry: mocks.budget, writeBudgetEvent: mocks.budgetEvent }));
vi.mock("@/lib/routing/execution-adapter-registry", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/routing/execution-adapter-registry")>(),
  getExecutionAdapter: () => ({ execute: mocks.executeAdapter }),
}));
vi.mock("@/lib/inference/inference-admission", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/inference/inference-admission")>(), acquireInferenceSlot: mocks.admit,
}));

const selection = { endpointId: "local", modelId: "ai/test", providerConnectionId: "provider-default-local" };
const identity = { modelDigest: `sha256:${"a".repeat(64)}`, engineIdentity: "Running: llama.cpp b9879-test",
  templateDigest: "b".repeat(64), configDigest: "c".repeat(64), dialect: "llama.cpp-b9879", observedAt: 1 };
type Dispatch = NonNullable<ToolExecutionContext["governedDispatch"]>;
let reads: ReturnType<typeof vi.fn<Dispatch>>;
let rows: Map<string, Record<string, unknown>>;
const context = () => ({ agentId: "agent", threadId: "thread", userContext: { platformRole: "ceo", isSuperuser: true },
  governedReadToolCatalog: mocks.tools, governedDispatch: reads });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.grants.mockReturnValue(true);
  mocks.budgetEvent.mockResolvedValue(undefined);
  rows = new Map();
  const names = [...new Set(GOLDEN_CASES.map(c => c.correctToolNames[0]!))];
  const tools = [...names, ...Array.from({ length: 48 }, (_, i) => `read_${i}`)].map(name => ({ name,
    description: "Read-only diagnostic fixture", inputSchema: { type: "object", properties: {} },
    sideEffect: false, requiredCapability: null }));
  mocks.tools.mockResolvedValue(tools);
  mocks.manifests.mockResolvedValue([{ providerId: "local", modelId: "ai/test", providerConnectionId: selection.providerConnectionId,
    providerConnectionVersion: "account-v1", status: "active", supportsToolUse: true, sensitivityClearance: ["public"], modelClass: "chat" }]);
  mocks.version.mockResolvedValue({ gitSha: "d".repeat(40), sourceContentHash: "e".repeat(64) });
  mocks.proof.mockResolvedValue(identity);
  mocks.provider.mockResolvedValue({ providerId: "local", baseUrl: "http://localhost:12434/engines/llama.cpp/v1", endpoint: null });
  mocks.create.mockResolvedValue({ id: "test-row", runId: "fidelity-run" });
  mocks.update.mockResolvedValue({});
  mocks.audit.mockImplementation(async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null);
  mocks.call.mockImplementation(async (_provider: string, _model: string, messages: Array<{ content: string }>) => {
    const golden = GOLDEN_CASES.find(c => c.prompt === messages[0]?.content)!;
    return { content: "", finishReason: "tool_calls", toolCalls: [{ name: golden.correctToolNames[0], arguments: {} }], raw: { model: "ai/test" } };
  });
  reads = vi.fn(async (name: string, parameters: Record<string, unknown>) => {
    const id = `read-${rows.size}`;
    rows.set(id, { id, toolName: name, parameters, userId: "u", agentId: "agent", threadId: "thread",
      taskRunId: null, success: true, durationMs: 1, result: { success: true } });
    return { success: true, message: "ok", governance: { toolExecutionId: id } };
  });
});
afterEach(() => vi.useRealTimers());

describe("bounded local fidelity diagnostic", () => {
  it("runs the nine goldens at five exact surfaces and retains attributable read IDs", async () => {
    const result = await runLocalToolFidelityDiagnostic(selection, "u", context());
    expect(result.success).toBe(true);
    expect(mocks.call).toHaveBeenCalledTimes(45);
    expect(reads).toHaveBeenCalledTimes(45);
    expect(mocks.call.mock.calls.map(call => (call[4] as unknown[]).length))
      .toEqual([8, 15, 24, 32, 48].flatMap(size => Array(9).fill(size)));
    expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) }));
    expect(mocks.tools).toHaveBeenCalledTimes(46);
  });
  it("never sends a tool result or model prose into another inference call", async () => {
    await runLocalToolFidelityDiagnostic(selection, "u", context());
    expect(mocks.call.mock.calls.every(call => (call[2] as unknown[]).length === 1)).toBe(true);
  });
  it("keeps a correct context-free read available when the first alternative needs an unknown target", async () => {
    const tools = await mocks.tools();
    mocks.tools.mockResolvedValue([...tools.map((tool: { name: string }) => tool.name === "get_workroom"
      ? { ...tool, inputSchema: { type: "object", properties: { capsuleId: { type: "string" } }, required: ["capsuleId"] } } : tool),
      { name: "list_workrooms", description: "List visible workrooms", sideEffect: false, requiredCapability: null,
        inputSchema: { type: "object", properties: {} } },
      ...Array.from({ length: 8 }, (_, i) => ({ name: `get_a${i}`, description: "Read-only fixture", sideEffect: false,
        requiredCapability: null, inputSchema: { type: "object", properties: {} } }))]);
    mocks.call.mockImplementation(async (_provider: string, _model: string, messages: Array<{ content: string }>) => {
      const golden = GOLDEN_CASES.find(c => c.prompt === messages[0]?.content)!;
      return { content: "", finishReason: "tool_calls", toolCalls: [{ name: golden.taskClass === "capsule-status"
        ? "list_workrooms" : golden.correctToolNames[0], arguments: {} }], raw: { model: "ai/test" } };
    });
    const result = await runLocalToolFidelityDiagnostic(selection, "u", context());
    expect(result.data).toMatchObject({ qualified: true });
    const firstSurface = mocks.call.mock.calls[0]![4] as Array<{ function: { name: string } }>;
    expect(firstSurface.map(tool => tool.function.name)).toContain("list_workrooms");
    expect(firstSurface).toHaveLength(8);
  });
  it("rejects a cloud selection before inference or test-run creation", async () => {
    const result = await runLocalToolFidelityDiagnostic({ ...selection, endpointId: "openai" }, "u", context());
    expect(result.success).toBe(false);
    expect(mocks.call).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not infer authority or audit correlation for an unbound caller", async () => {
    const result = await runLocalToolFidelityDiagnostic(selection, "u", { ...context(), governedDispatch: undefined });
    expect(result.success).toBe(false); expect(mocks.call).not.toHaveBeenCalled();
  });
  it("refuses a caller without the original server-owned catalog projection", async () => {
    const result = await runLocalToolFidelityDiagnostic(selection, "u", { ...context(), governedReadToolCatalog: undefined } as ToolExecutionContext);
    expect(result.success).toBe(false);
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("keeps unavailable exact model/runtime identity unrun", async () => {
    mocks.proof.mockResolvedValue(undefined);
    expect((await runLocalToolFidelityDiagnostic(selection, "u", context())).success).toBe(false);
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("does not execute wrong selections or count a missing audit as success", async () => {
    mocks.call.mockResolvedValue({ content: "query_backlog", finishReason: "stop", toolCalls: [], raw: { model: "ai/test" } });
    const result = await runLocalToolFidelityDiagnostic(selection, "u", context());
    expect(result.data).toMatchObject({ qualified: false }); expect(reads).not.toHaveBeenCalled();
  });
  it("fails read qualification when the returned audit ID is foreign", async () => {
    reads.mockResolvedValue({ success: true, message: "ok", governance: { toolExecutionId: "foreign" } });
    expect((await runLocalToolFidelityDiagnostic(selection, "u", context())).data).toMatchObject({ qualified: false });
  });
  it("stops without another call after observed model identity drift", async () => {
    mocks.proof.mockResolvedValueOnce(identity).mockResolvedValue({ ...identity, modelDigest: `sha256:${"f".repeat(64)}` });
    expect((await runLocalToolFidelityDiagnostic(selection, "u", context())).data).toMatchObject({ qualified: false });
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("records insufficient catalog surfaces as unrun instead of adding unauthorized tools", async () => {
    mocks.tools.mockResolvedValue([]);
    expect((await runLocalToolFidelityDiagnostic(selection, "u", context())).data).toMatchObject({ qualified: false });
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("ends the admitted run when its deadline expires, without retry or fallback", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    mocks.call.mockImplementation(async () => { vi.setSystemTime(300_000); throw new Error("timed out"); });
    expect((await runLocalToolFidelityDiagnostic(selection, "u", context())).data).toMatchObject({ qualified: false });
    expect(mocks.call).toHaveBeenCalledTimes(1);
  });
  it("starts no read when identity verification outlasts the turn deadline", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    mocks.proof.mockResolvedValueOnce(identity).mockResolvedValueOnce(identity).mockImplementationOnce(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
      return identity;
    });
    const result = await runLocalToolFidelityDiagnostic(selection, "u", context());
    expect(result.data).toMatchObject({ qualified: false });
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(reads).not.toHaveBeenCalled();
    expect((result.data!.observations as Array<{ status: string }>)[0]!.status).toBe("incomplete");
  });
  it("cannot score a pass when audit verification outlasts the turn deadline", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    mocks.audit.mockImplementationOnce(async ({ where }: { where: { id: string } }) => {
      await vi.advanceTimersByTimeAsync(30_001);
      return rows.get(where.id);
    });
    const result = await runLocalToolFidelityDiagnostic(selection, "u", context());
    expect(result.data).toMatchObject({ qualified: false });
    expect(mocks.call).toHaveBeenCalledTimes(1); expect(reads).toHaveBeenCalledTimes(1);
    expect((result.data!.observations as Array<{ status: string; executionPassed: boolean }>)[0])
      .toMatchObject({ status: "incomplete", executionPassed: false });
  });
  it("supports the original OAuth actor without inventing a conversation thread", async () => {
    reads.mockImplementation(async (name: string, parameters: Record<string, unknown>) => {
      const id = `oauth-read-${rows.size}`;
      rows.set(id, { id, toolName: name, parameters, userId: "u", agentId: "agent", threadId: "",
        taskRunId: null, success: true, durationMs: 1, result: {}, auditClass: "metrics_only" });
      return { success: true, message: "ok", governance: { toolExecutionId: id } };
    });
    const result = await runLocalToolFidelityDiagnostic(selection, "u", { ...context(), threadId: undefined,
      authSource: "oauth", apiTokenId: "original-token", tokenGrantScopes: ["admin_read"] });
    expect(result.data).toMatchObject({ qualified: true, capChanged: false });
    expect(reads).toHaveBeenCalledTimes(45);
    expect(mocks.call.mock.calls.every(call => call[8]?.agentId === "agent" && call[8]?.threadId === undefined)).toBe(true);
  });
  it("still refuses a caller without its original actor before inference", async () => {
    const result = await runLocalToolFidelityDiagnostic(selection, "u", { ...context(), agentId: undefined });
    expect(result.success).toBe(false);
    expect(mocks.call).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("stops a different-model or unattributable response before governed reads", async () => {
    mocks.call.mockResolvedValue({ content: "", finishReason: "tool_calls",
      toolCalls: [{ name: "query_backlog", arguments: {} }], raw: { model: "different-model" } });
    expect((await runLocalToolFidelityDiagnostic(selection, "u", context())).data).toMatchObject({ qualified: false });
    expect(mocks.call).toHaveBeenCalledTimes(1); expect(reads).not.toHaveBeenCalled();
  });
  it("does not reuse another account version", async () => {
    const initial = await mocks.manifests();
    mocks.manifests.mockResolvedValueOnce(initial).mockResolvedValue([{ ...initial[0], providerConnectionVersion: "changed" }]);
    expect((await runLocalToolFidelityDiagnostic(selection, "u", context())).data).toMatchObject({ qualified: false });
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("narrows the catalog by the originating token grants", async () => {
    mocks.grants.mockReturnValue(false);
    const ctx = { ...context(), apiTokenId: "origin-token", tokenGrantScopes: ["unrelated_read"] };
    expect((await runLocalToolFidelityDiagnostic(selection, "u", ctx)).data).toMatchObject({ qualified: false });
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("does not qualify duplicate audit IDs as independent observations", async () => {
    reads.mockImplementation(async () => {
      const id = "same-read";
      rows.set(id, { id, toolName: "query_backlog", parameters: {}, userId: "u", agentId: "agent", threadId: "thread",
        taskRunId: null, success: true, durationMs: 1, result: { success: true } });
      return { success: true, message: "ok", governance: { toolExecutionId: id } };
    });
    const result = await runLocalToolFidelityDiagnostic(selection, "u", context());
    expect(result.data).toMatchObject({ qualified: false });
    expect((result.data!.observations as Array<{ executionPassed: boolean }>).filter(o => o.executionPassed)).toHaveLength(1);
  });
  it("preserves truncated calls as incomplete without executing their proposed read", async () => {
    mocks.call.mockResolvedValue({ content: "", truncated: true, finishReason: "length",
      toolCalls: [{ name: "query_backlog", arguments: {} }], raw: { model: "ai/test" } });
    expect((await runLocalToolFidelityDiagnostic(selection, "u", context())).data).toMatchObject({ qualified: false });
    expect(reads).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "incomplete" }) }));
  });
  it("holds an uncleared local model without changing its ratings", async () => {
    const endpoints = await mocks.manifests();
    mocks.manifests.mockResolvedValue([{ ...endpoints[0], sensitivityClearance: [] }]);
    expect((await runLocalToolFidelityDiagnostic(selection, "u", context())).success).toBe(false);
    expect(mocks.call).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("stops an unfinished governed read at the observation deadline without retry", async () => {
    vi.useFakeTimers();
    reads.mockImplementation(() => new Promise(() => undefined));
    const pending = runLocalToolFidelityDiagnostic(selection, "u", context());
    await vi.advanceTimersByTimeAsync(31_000);
    expect((await pending).data).toMatchObject({ qualified: false });
    expect(mocks.call).toHaveBeenCalledTimes(1); expect(reads).toHaveBeenCalledTimes(1);
  });
  it("honors the real provider's daily actor budget before adapter dispatch", async () => {
    const account = { connectionId: selection.providerConnectionId, providerId: "local", status: "active", authMethod: "local",
      executionChannel: "direct-api", credentialEntryId: null, credentialEntry: null, accessibleModelIds: ["ai/test"],
      modelsVerifiedAt: null, evidenceStatus: "unreviewed" };
    mocks.account.mockResolvedValue(account);
    mocks.provider.mockResolvedValue({ providerId: "local", status: "active", baseUrl: "http://diagnostic.invalid/v1", authMethod: "none" });
    const manifests = await mocks.manifests();
    mocks.manifests.mockResolvedValue([{ ...manifests[0], providerConnectionVersion: accountExecutionVersion(account) }]);
    mocks.budget.mockResolvedValue({ status: "rejected", actualTokens: 100, limitTokens: 100, ratioPercent: 100 });
    const real = await vi.importActual<typeof import("@/lib/inference/ai-inference")>("@/lib/inference/ai-inference");
    mocks.call.mockImplementation(real.callProvider);
    const result = await runLocalToolFidelityDiagnostic(selection, "u", context());
    expect(result.data).toMatchObject({ qualified: false });
    expect(mocks.budget).toHaveBeenCalledWith("agent");
    expect(mocks.executeAdapter).not.toHaveBeenCalled(); expect(mocks.admit).not.toHaveBeenCalled();
    expect(reads).not.toHaveBeenCalled(); expect(mocks.call).toHaveBeenCalledTimes(1);
  });
});
