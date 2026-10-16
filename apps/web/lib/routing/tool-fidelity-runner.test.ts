import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GOLDEN_CASES } from "./tool-fidelity-harness";
import { runLocalToolFidelityDiagnostic } from "./tool-fidelity-runner";
import type { ToolExecutionContext } from "@/lib/mcp-tool-types";

const mocks = vi.hoisted(() => ({ call: vi.fn(), manifests: vi.fn(), tools: vi.fn(), version: vi.fn(),
  proof: vi.fn(), create: vi.fn(), update: vi.fn(), audit: vi.fn(), provider: vi.fn(), grants: vi.fn() }));
vi.mock("@/lib/ai-inference", () => ({ callProvider: mocks.call }));
vi.mock("./loader", () => ({ loadEndpointManifests: mocks.manifests, invalidateRoutingLoaderCache: vi.fn() }));
vi.mock("@/lib/mcp-tools", () => ({ getAvailableTools: mocks.tools }));
vi.mock("@/lib/platform/version", () => ({ loadPlatformVersion: mocks.version }));
vi.mock("@/lib/inference/dmr-runtime-config", () => ({ getLocalThinkingBudgetEvidence: mocks.proof }));
vi.mock("@/lib/agent-grants", () => ({ isToolAllowedByGrants: mocks.grants }));
vi.mock("@dpf/db", () => ({ prisma: { endpointTestRun: { create: mocks.create, update: mocks.update },
  toolExecution: { findUnique: mocks.audit }, modelProvider: { findUnique: mocks.provider } } }));

const selection = { endpointId: "local", modelId: "ai/test", providerConnectionId: "provider-default-local" };
const identity = { modelDigest: `sha256:${"a".repeat(64)}`, engineIdentity: "Running: llama.cpp b9879-test",
  templateDigest: "b".repeat(64), configDigest: "c".repeat(64), dialect: "llama.cpp-b9879", observedAt: 1 };
type Dispatch = NonNullable<ToolExecutionContext["governedDispatch"]>;
let reads: ReturnType<typeof vi.fn<Dispatch>>;
let rows: Map<string, Record<string, unknown>>;
const context = () => ({ agentId: "agent", threadId: "thread", userContext: { platformRole: "ceo", isSuperuser: true },
  roomAuthorizedGrants: ["backlog_read"], governedDispatch: reads });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.grants.mockReturnValue(true);
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
    expect(mocks.tools).toHaveBeenCalledWith(context().userContext, expect.objectContaining({ roomAuthorizedGrants: ["backlog_read"] }));
  });
  it("never sends a tool result or model prose into another inference call", async () => {
    await runLocalToolFidelityDiagnostic(selection, "u", context());
    expect(mocks.call.mock.calls.every(call => (call[2] as unknown[]).length === 1)).toBe(true);
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
});
