import { EventEmitter } from "node:events";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterRequest } from "./adapter-types";
import type { ToolExecutionContext, ToolResult } from "../mcp-tool-types";

// BI-5163AF47: real adapter -> signed token -> transport/list -> governed
// nested dispatcher. Only provider/process, persistence and source IO are fake.
// All identities/bytes/secrets are synthetic; no CLI, network or DB is used.
const fixture = vi.hoisted(() => ({
  writes: [] as Array<{ path: string; content: string }>,
  grants: ["initiative_evidence_write", "file_read"],
  active: true,
  reads: 0,
  calls: [] as string[],
}));
vi.mock("@/lib/inference/ai-provider-internals", () => ({
  getProviderBearerToken: vi.fn(async () => ({ token: "synthetic-provider-token" })),
  getDecryptedCredential: vi.fn(),
}));
vi.mock("./execution-adapter-registry", () => ({ registerExecutionAdapter: vi.fn() }));
vi.mock("./cli-concurrency", () => ({ withCliSlot: async (run: () => Promise<unknown>) => run() }));
vi.mock("./cli-pool-status", () => ({ recordCliRateLimit: vi.fn(), clearCliRateLimit: vi.fn() }));
vi.mock("@/lib/build/sandbox/agent-cli-runtime", () => ({
  writeSandboxFile: vi.fn(async (file: { path: string; content: string }) => { fixture.writes.push(file); }),
}));
vi.mock("@/lib/shared/lazy-node", () => ({
  lazyUtil: () => ({ promisify }),
  lazyChildProcess: () => ({
    execFile: (_file: string, _args: unknown, _opts: unknown, callback: Function) => callback(new Error("Unexpected source-IO subprocess in isolated test")),
    exec: (_cmd: string, _opts: unknown, callback: Function) => callback(null, { stdout: "", stderr: "" }),
    spawn: () => {
      const proc = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(),
      });
      setTimeout(() => {
        proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Synthetic provider finished." })));
        proc.emit("close", 0);
      }, 0);
      return proc;
    },
  }),
}));
vi.mock("@dpf/db", () => ({ prisma: {
  user: { findUnique: vi.fn(async () => ({ isActive: fixture.active, isSuperuser: true,
    groups: [{ platformRole: { roleId: "HR-000" } }] })) },
  agent: { findFirst: vi.fn(async () => ({ sensitivity: "internal" })) },
  taskRun: { findUnique: vi.fn(async () => ({ userId: "user-1", currentAgentId: "AGT-100",
    status: "working", a2aMetadata: {}, progressPayload: {} })) },
} }));
vi.mock("@/lib/tak/agent-grants", async (actual) => ({
  ...(await actual<typeof import("@/lib/tak/agent-grants")>()),
  getAgentToolGrantsAsync: vi.fn(async () => fixture.grants),
}));
vi.mock("@/lib/identity/load-effective-auth-context", () => ({
  loadEffectiveAuthContext: vi.fn(async () => ({ sensitivityClearance: ["public", "internal"] })),
}));
vi.mock("@/lib/self-upgrade/quiescence", () => ({
  getQuiescenceConfig: vi.fn(async () => ({ level: "normal", runId: null, enteredAt: null })),
}));
vi.mock("@/lib/agent-toolchain/connection-observation", () => ({ observeConnection: vi.fn() }));
vi.mock("@/lib/jobs", () => ({ jobs: { send: vi.fn() } }));

import { cliAdapter } from "./cli-adapter";
import { createMcpSessionToken, verifyMcpSessionToken } from "../mcp/session-token";
import { authenticateMcpRequest } from "../mcp/transport-auth";
import { POST } from "../../app/api/mcp/v1/route";
import { _setGovernanceForTests } from "../mcp-governed-execute";
import { coworkerAuthorityInputFixture } from "../../test-support/coworker-authority-input-fixture";
import { getToolGrantMapping } from "../tak/agent-grants";

const writer = "record_initiative_evidence";
const reader = "read_source_at_version";
const source = { repositoryFullName: "synthetic/repository", commitSha: "a".repeat(40),
  path: "docs/design.md", providerBlobId: "b".repeat(40) };
const fence = { schemaVersion: 1 as const, reservation: "synthetic-reservation", dispatchClaim: "synthetic-dispatch",
  authorityDigest: null, requestDigest: "9".repeat(64) };
const session = { userId: "user-1", agentId: "AGT-100", taskRunId: "TR-SYNTHETIC-516", taskExecutionFence: fence };

function rpc(token: string, method: string, params?: Record<string, unknown>) {
  return new Request("http://localhost:3000/api/mcp/v1?tier=full", { method: "POST",
    headers: { "content-type": "application/json", "X-MCP-Session": token, "user-agent": "claude-code/test" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
}

async function nativeToken(admitted: string[]) {
  const request: AdapterRequest = {
    providerId: "anthropic-sub", modelId: "synthetic-model",
    provider: { baseUrl: "cli://synthetic", headers: {} }, fetchImpl: vi.fn() as unknown as typeof fetch,
    plan: { providerId: "anthropic-sub", modelId: "synthetic-model", recipeId: null,
      contractFamily: "conversation", executionAdapter: "claude-cli", maxTokens: 64,
      providerSettings: {}, toolPolicy: {}, responsePolicy: {} },
    messages: [{ role: "user", content: "Record the synthetic result." }], systemPrompt: "Synthetic test only.",
    tools: [{ type: "function", function: { name: writer, parameters: { type: "object", properties: {} } } }],
    // The proposed field is intentionally carried as server context on the
    // current source, where the real producer ignores it (the regression).
    mcpSession: { ...session, ...{ admittedTokenGrantScopes: admitted } },
  };
  await cliAdapter.execute(request);
  const config = fixture.writes.find(file => /cli-mcp-.*\.json$/.test(file.path));
  expect(config, "native producer must actually stage an MCP configuration").toBeDefined();
  return JSON.parse(config!.content).mcpServers.dpf.headers["X-MCP-Session"] as string;
}

async function callWriter(token: string) {
  const response = await POST(rpc(token, "tools/call", { name: writer, arguments: { source } }));
  expect(response.status).toBe(200);
  const body = await response.json();
  return JSON.parse(body.result.content[0].text.replace(/^.*\n(?=\{)/s, "")) as ToolResult;
}

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "synthetic-BI516-test-only-signing-material-never-install-credentials");
  fixture.writes = []; fixture.grants = ["initiative_evidence_write", "file_read"];
  fixture.active = true; fixture.reads = 0; fixture.calls = [];
  _setGovernanceForTests({
    resolveAgentGrants: async () => fixture.grants,
    resolveCoworkerAuthorityInput: async () => coworkerAuthorityInputFixture(),
    toolExecutionCreate: async () => undefined, authorizationDecisionCreate: async () => undefined,
    toolExecutionReceiptCreate: async () => undefined,
    // Domain effects are IO seams. Crucially, the writer calls the REAL
    // governedDispatch, never a copied grant predicate or direct fake read.
    executeTool: async (name: string, params: Record<string, unknown>, _user: string, context?: ToolExecutionContext) => {
      fixture.calls.push(name);
      if (name === writer) return context!.governedDispatch!(reader, params.source as Record<string, unknown>);
      expect(name).toBe(reader); expect(params).toEqual(source);
      expect(context?.taskRunId).toBe(session.taskRunId);
      expect(context?.taskExecutionFence).toEqual(fence);
      fixture.reads++;
      return { success: true, message: "Synthetic immutable bytes read.", data: { bytes: "synthetic-source" } };
    },
    toolPreflight: async () => null,
  });
});
afterEach(() => {
  _setGovernanceForTests({ resolveAgentGrants: null, resolveCoworkerAuthorityInput: null,
    toolExecutionCreate: null, authorizationDecisionCreate: null, toolExecutionReceiptCreate: null,
    executeTool: null, toolPreflight: null });
  vi.unstubAllEnvs();
});

describe("BI-5163AF47 native terminal-writer authority", () => {
  it("control: the existing nested dispatcher succeeds with originally admitted reader authority", async () => {
    expect(getToolGrantMapping()[writer]).toContain("initiative_evidence_write");
    const token = await createMcpSessionToken({ ...session,
      scopes: ["initiative_evidence_write", "file_read"], capability: "write" });
    expect(await callWriter(token)).toMatchObject({ success: true });
    expect(fixture.reads).toBe(1);
    expect(fixture.calls).toEqual([writer, reader]);
  });

  it("retains originally admitted reader authority through the real writer-only native producer", async () => {
    const token = await nativeToken(["initiative_evidence_write", "file_read"]);
    const verified = await verifyMcpSessionToken(token);
    expect(verified).toMatchObject({ taskRunId: session.taskRunId, taskExecutionFence: fence, capability: "write" });
    const auth = await authenticateMcpRequest(rpc(token, "tools/list"));
    expect(auth.ok).toBe(true);
    const listing = await (await POST(rpc(token, "tools/list"))).json();
    expect(listing.result.tools.map((tool: { name: string }) => tool.name)).toContain(writer);
    const result = await callWriter(token);
    expect(result, "original file_read must survive writer-only presentation").toMatchObject({ success: true });
    expect(fixture.reads).toBe(1);
    expect(verified!.scopes).toContain("file_read");
  });

  it("does not invent nested reader authority when it was never admitted", async () => {
    const token = await nativeToken(["initiative_evidence_write"]);
    expect(await callWriter(token)).toMatchObject({ success: false, error: "insufficient_token_scope" });
    expect(fixture.reads).toBe(0);
  });
});
