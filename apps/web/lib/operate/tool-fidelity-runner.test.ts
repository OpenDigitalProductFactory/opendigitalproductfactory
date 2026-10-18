import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GOLDEN_CASES } from "@/lib/routing/tool-fidelity-harness";
import { runLocalToolFidelityDiagnostic } from "./tool-fidelity-runner";
import type { ToolExecutionContext } from "@/lib/mcp-tool-types";
import { accountExecutionVersion } from "@/lib/routing/provider-account-candidates";
import { currentInferenceSignal, assertGovernedInferenceAuthority, withInferenceCancellation } from "@/lib/routing/governed-inference-deadline";
import { admissionObservation } from "@/lib/inference/inference-admission";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { expandGrants } from "@/lib/agent-grants";

const mocks = vi.hoisted(() => ({ call: vi.fn(), manifests: vi.fn(), tools: vi.fn(), version: vi.fn(),
  proof: vi.fn(), create: vi.fn(), update: vi.fn(), audit: vi.fn(), provider: vi.fn(), grants: vi.fn(),
  account: vi.fn(), budget: vi.fn(), budgetEvent: vi.fn(), executeAdapter: vi.fn(), admit: vi.fn(),
  checkpointRead: vi.fn(), user: vi.fn(), agent: vi.fn(), token: vi.fn(), authorityKey: vi.fn(),
  room: vi.fn(), roomAuthority: vi.fn(), access: vi.fn(), providerFetch: vi.fn() }));
vi.mock("@/lib/routing/local-provider-capacity", () => ({ assertProviderDispatchCapacity: vi.fn() }));
vi.mock("@/lib/queue/resource-lane", () => ({ withLocalInferenceLock: (work: () => unknown) => work() }));
vi.mock("@/lib/inference/provider-inference-transport", () => ({
  providerInferenceFetch: mocks.providerFetch,
  withInferenceCancellationFetch: (fetchImpl: typeof fetch) => fetchImpl,
}));
vi.mock("@/lib/routing/adapter-telemetry-writer", () => ({ writeAdapterTelemetry: vi.fn() }));
vi.mock("@/lib/routing/provider-capacity/store", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/routing/provider-capacity/store")>(),
  clearProviderCapacityStatus: vi.fn().mockResolvedValue(undefined), recordProviderCapacityStatus: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: mocks.user }));
vi.mock("@/lib/auth/oauth-task-authority", () => ({ resolveMcpTaskAuthorityKey: mocks.authorityKey }));
vi.mock("@/lib/work-management/room-turn-authority.server", () => ({ loadRoomTurnAuthority: mocks.roomAuthority }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({ resolveAgentWorkroomAccess: mocks.access }));
vi.mock("@/lib/ai-inference", () => ({ callProvider: mocks.call }));
vi.mock("@/lib/routing/loader", () => ({ loadEndpointManifests: mocks.manifests, invalidateRoutingLoaderCache: vi.fn() }));
vi.mock("@/lib/platform/version", () => ({ loadPlatformVersion: mocks.version }));
vi.mock("@/lib/inference/dmr-runtime-config", () => ({ getLocalThinkingBudgetEvidence: mocks.proof }));
vi.mock("@/lib/agent-grants", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/agent-grants")>(), isToolAllowedByGrants: mocks.grants,
}));
vi.mock("@dpf/db", () => ({ prisma: { endpointTestRun: { create: mocks.create, updateMany: mocks.update, findUnique: mocks.checkpointRead },
  agent: { findUnique: mocks.agent }, mcpApiToken: { findUnique: mocks.token }, workroom: { findUnique: mocks.room },
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

const selection = { endpointId: "local", modelId: "ai/test", providerConnectionId: "provider-default-local", fidelityObservationIndex: 0 };
const identity = { modelDigest: `sha256:${"a".repeat(64)}`, engineIdentity: "Running: llama.cpp b9879-test",
  templateDigest: "b".repeat(64), configDigest: "c".repeat(64), dialect: "llama.cpp-b9879", observedAt: 1 };
type Dispatch = NonNullable<ToolExecutionContext["governedDispatch"]>;
let reads: ReturnType<typeof vi.fn<Dispatch>>;
let rows: Map<string, Record<string, unknown>>;
const context = () => ({ agentId: "agent", threadId: "thread", userContext: { platformRole: "ceo", isSuperuser: true },
  governedReadToolCatalog: mocks.tools, governedDispatch: reads, governedRoomAuthority: () => null });
let checkpointRow: Record<string, any> | null;
async function completeMatrix(ctx: ToolExecutionContext = context()) {
  let result = await runLocalToolFidelityDiagnostic(selection, "u", ctx);
  for (let index = 1; index < 45 && (result.data?.checkpoint as { state?: string } | undefined)?.state === "ready"; index++) {
    result = await runLocalToolFidelityDiagnostic({ ...selection, fidelityRunId: result.data!.runId as string,
      fidelityObservationIndex: index }, "u", ctx);
  }
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  checkpointRow = null;
  mocks.user.mockResolvedValue({ platformRole: "ceo", platformRoles: ["ceo"], isSuperuser: true });
  mocks.agent.mockResolvedValue({ status: "active", archived: false });
  mocks.authorityKey.mockResolvedValue("oauth-family:stable-authority");
  mocks.token.mockResolvedValue({ userId: "u", agentId: "agent", scopes: ["admin_read"], scope: "read",
    kind: "oauth_access", revokedAt: null, expiresAt: null, workroomRef: null, runRef: null });
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
  mocks.create.mockImplementation(async ({ data }) => {
    if (checkpointRow) throw { code: "P2002" };
    checkpointRow = { id: "test-row", ...structuredClone(data) };
    return structuredClone(checkpointRow);
  });
  mocks.checkpointRead.mockImplementation(async () => structuredClone(checkpointRow));
  mocks.update.mockImplementation(async ({ where, data }) => {
    if (!checkpointRow || checkpointRow.id !== where.id || checkpointRow.status !== where.status
      || canonicalJson(checkpointRow.results) !== canonicalJson(where.results.equals)) return { count: 0 };
    Object.assign(checkpointRow, structuredClone(data));
    return { count: 1 };
  });
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
    const result = await completeMatrix();
    expect(result.success).toBe(true);
    expect(mocks.call).toHaveBeenCalledTimes(45);
    expect(reads).toHaveBeenCalledTimes(45);
    expect(mocks.call.mock.calls.map(call => (call[4] as unknown[]).length))
      .toEqual([8, 15, 24, 32, 48].flatMap(size => Array(9).fill(size)));
    expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) }));
    expect(mocks.tools.mock.calls.length).toBeGreaterThanOrEqual(45);
  });
  it("accepts exactly one explicit observation per request instead of an implicit matrix", async () => {
    const result = await runLocalToolFidelityDiagnostic({ ...selection, fidelityObservationIndex: 0 }, "u", context());
    expect(result.success).toBe(true);
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(result.data).toMatchObject({ qualified: false, checkpoint: { nextIndex: 1, state: "ready" } });
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
    const result = await completeMatrix();
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
    const answer = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation(async (...args) => {
      const result = await answer(...args);
      mocks.proof.mockImplementationOnce(async () => { await vi.advanceTimersByTimeAsync(240_001); return identity; });
      return result;
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
      await vi.advanceTimersByTimeAsync(240_001);
      return rows.get(where.id);
    });
    const result = await runLocalToolFidelityDiagnostic(selection, "u", context());
    expect(result.data).toMatchObject({ qualified: false });
    expect(mocks.call).toHaveBeenCalledTimes(1); expect(reads).toHaveBeenCalledTimes(1);
    expect((result.data!.observations as Array<{ status: string; executionPassed: boolean }>)[0])
      .toMatchObject({ status: "incomplete", executionPassed: false });
  });
  it("starts no read after expiry while the abort callback is still pending", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    let signal: AbortSignal | undefined;
    const answer = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation(async (...args) => {
      signal = currentInferenceSignal();
      const result = await answer(...args);
      mocks.proof.mockImplementationOnce(async () => {
        vi.setSystemTime(240_001);
        expect(signal?.aborted).toBe(false);
        return identity;
      });
      return result;
    });
    const result = await runLocalToolFidelityDiagnostic(selection, "u", context());
    expect(result.data).toMatchObject({ qualified: false });
    expect(mocks.call).toHaveBeenCalledTimes(1); expect(reads).not.toHaveBeenCalled();
  });
  it("cannot qualify late audit proof before the abort callback is delivered", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    let signal: AbortSignal | undefined;
    const answer = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation((...args) => { signal = currentInferenceSignal(); return answer(...args); });
    mocks.audit.mockImplementationOnce(async ({ where }: { where: { id: string } }) => {
      vi.setSystemTime(240_001);
      expect(signal?.aborted).toBe(false);
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
    const result = await completeMatrix({ ...context(), threadId: undefined,
      authSource: "oauth", apiTokenId: "original-token", tokenGrantScopes: ["admin_read"], tokenScope: "read" });
    expect(result.data).toMatchObject({ qualified: true, capChanged: false });
    expect(reads).toHaveBeenCalledTimes(45);
    expect(mocks.call.mock.calls.every(call => call[8]?.agentId === "agent" && call[8]?.threadId === undefined)).toBe(true);
  });
  it("still refuses a caller without its original actor before inference", async () => {
    const result = await runLocalToolFidelityDiagnostic(selection, "u", { ...context(), agentId: undefined });
    expect(result.success).toBe(false);
    expect(mocks.call).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(["backlog_write", "work_capsule_write", "browser_drive", "registry_write"])(
    "accepts the external route's effective %s token grants for execution and readback", async grant => {
      const scopes = ["admin_read", grant];
      const tokenGrantScopes = expandGrants(scopes);
      expect(tokenGrantScopes.length).toBeGreaterThan(scopes.length);
      mocks.token.mockResolvedValue({ userId: "u", agentId: "agent", scopes, scope: "write",
        kind: "oauth_access", revokedAt: null, expiresAt: null, workroomRef: null, runRef: null });
      const ctx = { ...context(), apiTokenId: "original-token", authSource: "oauth",
        tokenScope: "write" as const, tokenGrantScopes };
      const first = await runLocalToolFidelityDiagnostic(selection, "u", ctx);
      expect(first.data).toMatchObject({ checkpoint: { nextIndex: 1, state: "ready" } });
      expect((first.data!.observations as Array<unknown>)[0]).toMatchObject({ status: "passed", executionPassed: true });
      const replay = await runLocalToolFidelityDiagnostic({ ...selection, fidelityRunId: first.data!.runId as string }, "u", ctx);
      expect(replay.data).toMatchObject({ checkpoint: { nextIndex: 1, state: "ready" } });
      expect(mocks.call).toHaveBeenCalledTimes(1); expect(reads).toHaveBeenCalledTimes(1);
    });
  it.each(["revoked", "grant-removed"])("still stops an implied-grant token %s during admission", async change => {
    const token = { userId: "u", agentId: "agent", scopes: ["admin_read", "backlog_write"], scope: "write",
      kind: "oauth_access", revokedAt: null as Date | null, expiresAt: null, workroomRef: null, runRef: null };
    mocks.token.mockResolvedValue(token);
    const ctx = { ...context(), apiTokenId: "original-token", authSource: "oauth",
      tokenScope: "write" as const, tokenGrantScopes: expandGrants(token.scopes) };
    const dispatch = vi.fn();
    mocks.call.mockImplementation(async () => {
      admissionObservation("local", "interactive")("queued");
      if (change === "revoked") token.revokedAt = new Date();
      else token.scopes = ["admin_read"];
      await assertGovernedInferenceAuthority();
      dispatch();
    });
    const result = await runLocalToolFidelityDiagnostic(selection, "u", ctx);
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled(); expect(reads).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ qualified: false, capChanged: false, checkpoint: { state: "held" } });
  });
  it.each(["revoked", "grant-removed"])("refuses an implied-grant token %s before lost-response readback", async change => {
    const token = { userId: "u", agentId: "agent", scopes: ["admin_read", "backlog_write"], scope: "write",
      kind: "oauth_access", revokedAt: null as Date | null, expiresAt: null, workroomRef: null, runRef: null };
    mocks.token.mockResolvedValue(token);
    const ctx = { ...context(), apiTokenId: "original-token", authSource: "oauth",
      tokenScope: "write" as const, tokenGrantScopes: expandGrants(token.scopes) };
    const first = await runLocalToolFidelityDiagnostic(selection, "u", ctx);
    expect(first.data).toMatchObject({ checkpoint: { nextIndex: 1, state: "ready" } });
    if (change === "revoked") token.revokedAt = new Date();
    else token.scopes = ["admin_read"];
    const replay = await runLocalToolFidelityDiagnostic({ ...selection, fidelityRunId: first.data!.runId as string }, "u", ctx);
    expect(replay.success).toBe(false);
    expect(mocks.call).toHaveBeenCalledTimes(1); expect(reads).toHaveBeenCalledTimes(1);
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
    const ctx = { ...context(), apiTokenId: "origin-token", tokenGrantScopes: ["admin_read"], tokenScope: "read" as const };
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
    const result = await completeMatrix();
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
    await vi.advanceTimersByTimeAsync(240_001);
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
  it.each([
    ["ai/test", true], ["docker.io/ai/test:latest", true], ["ai/other", false], [undefined, false],
    [`C:\\Users\\fixture\\.docker\\models\\bundles\\sha256\\${"a".repeat(64)}\\model\\model.gguf`, true],
    [`/var/lib/docker/models/bundles/sha256/${"a".repeat(64)}/model/model.gguf`, true],
    [`C:\\models\\bundles\\sha256\\${"f".repeat(64)}\\model\\model.gguf`, false],
    [`models/bundles/sha256/${"a".repeat(64)}/model/model.gguf`, false],
    [`/models/../bundles/sha256/${"a".repeat(64)}/model/model.gguf`, false],
    [`/models/./bundles/sha256/${"a".repeat(64)}/model/model.gguf`, false],
    [`/models/\u0000/bundles/sha256/${"a".repeat(64)}/model/model.gguf`, false],
    ["model.gguf", false],
  ])("carries real chat response model %s through inference to fidelity", async (returnedModel, accepted) => {
    const account = { connectionId: selection.providerConnectionId, providerId: "local", status: "active", authMethod: "local",
      executionChannel: "direct-api", credentialEntryId: null, credentialEntry: null, accessibleModelIds: ["ai/test"],
      modelsVerifiedAt: null, evidenceStatus: "unreviewed" };
    mocks.account.mockResolvedValue(account);
    mocks.provider.mockResolvedValue({ providerId: "local", status: "active", baseUrl: "http://provider.invalid/v1", authMethod: "none" });
    const manifests = await mocks.manifests();
    mocks.manifests.mockResolvedValue([{ ...manifests[0], providerConnectionVersion: accountExecutionVersion(account) }]);
    mocks.budget.mockResolvedValue({ status: "ok" });
    mocks.providerFetch.mockResolvedValue(new Response(JSON.stringify({
      model: returnedModel, choices: [{ finish_reason: "tool_calls", message: { content: "", tool_calls: [{
        id: "provider-tool-fixture", type: "function", function: { name: GOLDEN_CASES[0]!.correctToolNames[0], arguments: "{}" },
      }] } }], usage: { prompt_tokens: 2, completion_tokens: 1 },
    }), { status: 200 }));
    const { chatAdapter } = await import("@/lib/routing/chat-adapter");
    mocks.executeAdapter.mockImplementation(request => chatAdapter.execute(request));
    const real = await vi.importActual<typeof import("@/lib/inference/ai-inference")>("@/lib/inference/ai-inference");
    mocks.call.mockImplementation(real.callProvider);
    const result = await runLocalToolFidelityDiagnostic(selection, "u", context());
    expect(mocks.providerFetch).toHaveBeenCalledTimes(1);
    expect(mocks.executeAdapter).toHaveBeenCalledTimes(1);
    expect((result.data!.observations as Array<unknown>)[0]).toMatchObject({
      status: accepted ? "passed" : "incomplete", executionPassed: accepted,
      reason: accepted ? "verified_governed_read" : "model_identity_unverified",
    });
    expect(reads).toHaveBeenCalledTimes(accepted ? 1 : 0);
    expect(result.data).toMatchObject({ capChanged: false, checkpoint: { state: accepted ? "ready" : "held" } });
  });
  it.each([
    { ...identity, dialect: "unverified-engine" },
    { ...identity, modelDigest: "not-a-runtime-digest" },
  ])("rejects bundle identity without supported runtime proof %j", async proof => {
    mocks.proof.mockResolvedValue(proof);
    mocks.call.mockResolvedValue({ content: "", finishReason: "tool_calls", toolCalls: [{
      name: GOLDEN_CASES[0]!.correctToolNames[0], arguments: {},
    }], raw: { model: `/models/bundles/sha256/${"a".repeat(64)}/model/model.gguf` } });
    const result = await runLocalToolFidelityDiagnostic(selection, "u", context());
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(reads).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ capChanged: false, checkpoint: { state: "held" } });
    expect((result.data!.observations as Array<unknown>)[0]).toMatchObject({ reason: "model_identity_unverified" });
  });
  it("rejects a matching returned bundle when runtime identity changes after dispatch", async () => {
    mocks.call.mockImplementation(async () => {
      mocks.proof.mockResolvedValue({ ...identity, configDigest: "f".repeat(64) });
      return { content: "", finishReason: "tool_calls", toolCalls: [{ name: GOLDEN_CASES[0]!.correctToolNames[0], arguments: {} }],
        raw: { model: `/models/bundles/sha256/${"a".repeat(64)}/model/model.gguf` } };
    });
    const result = await runLocalToolFidelityDiagnostic(selection, "u", context());
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(reads).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ capChanged: false, checkpoint: { state: "held" } });
    expect((result.data!.observations as Array<unknown>)[0]).toMatchObject({ reason: "model_identity_unverified" });
  });
  it("allows a healthy call beyond thirty seconds inside the existing admission and execution policies", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const answer = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation(async (...args) => {
      const observe = admissionObservation("local", "interactive");
      observe("queued");
      await vi.advanceTimersByTimeAsync(60_000);
      observe("acquired");
      await assertGovernedInferenceAuthority();
      await vi.advanceTimersByTimeAsync(60_000);
      const result = await answer(...args);
      observe("released");
      return result;
    });
    const result = await runLocalToolFidelityDiagnostic(selection, "u", context());
    expect((result.data!.observations as Array<unknown>)[0]).toMatchObject({ status: "passed", executionPassed: true,
      timing: { queuedAt: 0, acquiredAt: 60_000, releasedAt: 120_000,
        phaseAtStop: "after-acquisition", providerDispatch: "unverified" } });
    expect(mocks.call).toHaveBeenCalledTimes(1);
  });
  it.each(["human", "agent", "token", "catalog"])("refuses dispatch when %s authority changes during admission", async change => {
    const ctx = { ...context(), apiTokenId: "original-token", authSource: "oauth", tokenScope: "read" as const,
      tokenGrantScopes: ["admin_read"] };
    const dispatch = vi.fn();
    mocks.call.mockImplementation(async () => {
      admissionObservation("local", "interactive")("queued");
      if (change === "human") mocks.user.mockResolvedValue(null);
      if (change === "agent") mocks.agent.mockResolvedValue({ status: "inactive", archived: false });
      if (change === "token") mocks.token.mockResolvedValue(null);
      if (change === "catalog") mocks.tools.mockResolvedValue([]);
      await assertGovernedInferenceAuthority();
      dispatch();
    });
    const result = await runLocalToolFidelityDiagnostic(selection, "u", ctx);
    expect(dispatch).not.toHaveBeenCalled();
    expect(reads).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ qualified: false, checkpoint: { state: "held" } });
  });
  it("reauthorizes a lost-response readback without executing the next case", async () => {
    const first = await runLocalToolFidelityDiagnostic(selection, "u", context());
    const replay = await runLocalToolFidelityDiagnostic({ ...selection, fidelityRunId: first.data!.runId as string }, "u", context());
    expect(replay.data).toMatchObject({ checkpoint: { nextIndex: 1, state: "ready" } });
    expect(mocks.call).toHaveBeenCalledTimes(1);
    mocks.user.mockResolvedValue(null);
    expect((await runLocalToolFidelityDiagnostic({ ...selection, fidelityRunId: first.data!.runId as string }, "u", context())).success).toBe(false);
    expect(mocks.call).toHaveBeenCalledTimes(1);
  });
  it("rejects continuation without a run ID before creating a checkpoint", async () => {
    expect((await runLocalToolFidelityDiagnostic({ ...selection, fidelityObservationIndex: 1 }, "u", context())).success).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.call).not.toHaveBeenCalled();
  });
  it.each([undefined, () => { throw new Error("unknown room"); }])("does not treat absent or failed trusted room getters as unroomed", async getter => {
    expect((await runLocalToolFidelityDiagnostic(selection, "u", { ...context(), governedRoomAuthority: getter })).success).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.call).not.toHaveBeenCalled();
  });
  it.each(["terminal", "membership", "shape", "grants"])("stops when the original room's %s changes while waiting", async change => {
    const room = { workroomId: "WC-EXACT", collaborationShape: null, workShapeKey: null,
      authorizedGrants: ["admin_read"], actionBoundary: null, participantRoles: ["reviewer"], memberOfRoom: true };
    mocks.room.mockResolvedValue({ id: "room-row", status: "working", archivedAt: null });
    mocks.roomAuthority.mockResolvedValue(room);
    mocks.access.mockResolvedValue({ decision: { level: "content" } });
    const dispatch = vi.fn();
    mocks.call.mockImplementation(async () => {
      admissionObservation("local", "interactive")("queued");
      if (change === "terminal") mocks.room.mockResolvedValue({ id: "room-row", status: "complete", archivedAt: null });
      if (change === "membership") mocks.access.mockResolvedValue({ decision: { level: "none" } });
      if (change === "shape") mocks.roomAuthority.mockResolvedValue({ ...room, workShapeKey: "different@1.0.0" });
      if (change === "grants") mocks.roomAuthority.mockResolvedValue({ ...room, authorizedGrants: [] });
      await assertGovernedInferenceAuthority();
      dispatch();
    });
    const result = await runLocalToolFidelityDiagnostic(selection, "u", { ...context(), governedRoomAuthority: () => room });
    expect(dispatch).not.toHaveBeenCalled(); expect(reads).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ qualified: false, checkpoint: { state: "held" } });
    expect(mocks.access).toHaveBeenCalledWith({ userId: "u", agentId: "agent", workroomId: "room-row", requested: "content" });
  });
  it.each([false, true])("records cancellation after acquisition=%s without a false model failure or retry", async acquired => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const parent = new AbortController();
    mocks.call.mockImplementation(async () => {
      const observe = admissionObservation("local", "interactive");
      observe("queued");
      if (acquired) observe("acquired");
      return new Promise(() => undefined);
    });
    const pending = withInferenceCancellation(parent.signal, () => runLocalToolFidelityDiagnostic(selection, "u", context()));
    await vi.advanceTimersByTimeAsync(1);
    parent.abort(new Error("caller canceled"));
    const result = await pending;
    expect(mocks.call).toHaveBeenCalledTimes(1); expect(reads).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ qualified: false, checkpoint: { state: "held" } });
    expect((result.data!.observations as Array<unknown>)[0]).toMatchObject({ status: "incomplete", executionPassed: false,
      timing: { phaseAtStop: acquired ? "after-acquisition" : "waiting", providerDispatch: "unverified" } });
    await runLocalToolFidelityDiagnostic(selection, "u", context());
    expect(mocks.call).toHaveBeenCalledTimes(1);
  });
});
