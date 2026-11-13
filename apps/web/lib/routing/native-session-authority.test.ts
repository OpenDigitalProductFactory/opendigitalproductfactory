import { EventEmitter } from "node:events";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as jose from "jose";
import { parseTaskExecutionFence } from "../shared/task-execution-fence";
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
  bound: false,
  taskStatus: "working",
  taskReservation: "synthetic-reservation",
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
  taskRun: { findUnique: vi.fn(async (args: { where: { taskRunId: string } }) => args.where.taskRunId !== "TR-SYNTHETIC-516" ? null : ({
    userId: "user-1", currentAgentId: "AGT-100", status: fixture.taskStatus,
    a2aMetadata: fixture.bound ? { requestDigest: "9".repeat(64), initiativeReviewBinding: {
      itemId: "BI-SYNTHETIC", gate: "research", writerToolName: "record_initiative_evidence",
      artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "synthetic/repository", commitSha: "a".repeat(40),
        path: "docs/design.md", providerBlobId: "b".repeat(40) },
    } } : {},
    progressPayload: fixture.bound ? { resumeReservedAt: fixture.taskReservation, dispatch: { claimedAt: "synthetic-dispatch" } } : {},
  })) },
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
const signingSecret = "synthetic-BI516-test-only-signing-material-never-install-credentials";
const ordinaryAudience = "dpf-mcp-server";
const restrictedAudience = "dpf-mcp-server-restricted-v1";
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
  vi.stubEnv("AUTH_SECRET", signingSecret);
  fixture.writes = []; fixture.grants = ["initiative_evidence_write", "file_read"];
  fixture.active = true; fixture.reads = 0; fixture.calls = [];
  fixture.bound = false; fixture.taskStatus = "working"; fixture.taskReservation = "synthetic-reservation";
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

  it("keeps reader authority nested and exposes only the signed writer surface", async () => {
    const token = await nativeToken(["initiative_evidence_write", "file_read"]);
    const listing = await (await POST(rpc(token, "tools/list"))).json();
    expect(listing.result.tools.map((tool: { name: string }) => tool.name)).toEqual([writer]);
    for (const name of [reader, "load_tools"]) {
      const result = await (await POST(rpc(token, "tools/call", { name, arguments: { names: [reader], ...source } }))).json();
      expect(result.result.isError).toBe(true);
    }
    expect(fixture.calls).toEqual([]);
    expect(fixture.reads).toBe(0);
  });

  it("does not add backlog_read or silently downgrade an explicitly empty authority set", async () => {
    const token = await nativeToken(["initiative_evidence_write"]);
    expect((await verifyMcpSessionToken(token))!.scopes).toEqual(["initiative_evidence_write"]);
    fixture.writes = [];
    await expect(nativeToken([])).rejects.toThrow();
    expect(fixture.writes).toEqual([]);
  });

  it("refuses restricted issuance failure before legacy text/provider execution", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    await expect(nativeToken(["initiative_evidence_write", "file_read"])).rejects.toThrow();
    expect(fixture.writes).toEqual([]);
  });

  it("does not invent nested reader authority when it was never admitted", async () => {
    const token = await nativeToken(["initiative_evidence_write"]);
    expect(await callWriter(token)).toMatchObject({ success: false, error: "insufficient_token_scope" });
    expect(fixture.reads).toBe(0);
  });

  it("rechecks coworker reader revocation after native token issuance", async () => {
    const token = await nativeToken(["initiative_evidence_write", "file_read"]);
    fixture.grants = ["initiative_evidence_write"];
    expect(await callWriter(token)).toMatchObject({ success: false });
    expect(fixture.reads).toBe(0);
  });

  it("rechecks current human eligibility rather than trusting the signed token", async () => {
    const token = await nativeToken(["initiative_evidence_write", "file_read"]);
    fixture.active = false;
    const response = await POST(rpc(token, "tools/call", { name: writer, arguments: { source } }));
    expect(response.status).toBe(401);
    expect(fixture.calls).toEqual([]);
    expect(fixture.reads).toBe(0);
  });

  it("preserves an actually bound working review's captured fence", async () => {
    fixture.bound = true;
    const token = await nativeToken(["initiative_evidence_write", "file_read"]);
    expect(await callWriter(token)).toMatchObject({ success: true });
    expect(fixture.reads).toBe(1);
  });

  it.each(["held", "new-generation", "other-task"])("refuses %s at the real bound transport fence", async (change) => {
    fixture.bound = true;
    let token = await nativeToken(["initiative_evidence_write", "file_read"]);
    if (change === "held") fixture.taskStatus = "input-required";
    if (change === "new-generation") fixture.taskReservation = "new-reservation";
    if (change === "other-task") token = await syntheticSigned(restrictedAudience, {
      taskRunId: "TR-OTHER", toolSurface: { version: 1, toolNames: [writer] },
    });
    const response = await POST(rpc(token, "tools/call", { name: writer, arguments: { source } }));
    expect(response.status).toBe(403);
    expect((await response.json()).error.data.error).toBe("review_execution_authority_refused");
    expect(fixture.calls).toEqual([]); expect(fixture.reads).toBe(0);
  });
});

async function syntheticSigned(audience: string | string[], extra: Record<string, unknown>) {
  return new jose.SignJWT({ agentId: "AGT-100", taskRunId: session.taskRunId,
    taskExecutionFence: fence, scopes: ["initiative_evidence_write", "file_read"], capability: "write", ...extra })
    .setProtectedHeader({ alg: "HS256" }).setSubject("user-1").setIssuer("dpf-mcp-internal")
    .setAudience(audience).setIssuedAt().setExpirationTime("300s")
    .sign(new TextEncoder().encode(signingSecret));
}

describe("restricted-session protocol and actual legacy receiver", () => {
  it.each([
    [restrictedAudience, {}],
    [ordinaryAudience, { toolSurface: { version: 1, toolNames: [writer] } }],
    [[ordinaryAudience, restrictedAudience], { toolSurface: { version: 1, toolNames: [writer] } }],
    [restrictedAudience, { toolSurface: { version: 99, toolNames: [writer] } }],
    [restrictedAudience, { toolSurface: { version: 1, toolNames: [writer, writer] } }],
    [restrictedAudience, { toolSurface: { version: 1, toolNames: ["invented_tool"] } }],
    [restrictedAudience, { toolSurface: { version: 1, toolNames: [writer] }, taskRunId: null }],
    [restrictedAudience, { toolSurface: { version: 1, toolNames: [writer] }, taskExecutionFence: null }],
  ] as Array<[string | string[], Record<string, unknown>]>)
    ("refuses incoherent audience/surface/task binding %#", async (audience, extra) => {
      expect(await verifyMcpSessionToken(await syntheticSigned(audience, extra))).toBeNull();
    });

  it("accepts a coherent empty surface as no direct tools, never as unrestricted", async () => {
    const token = await syntheticSigned(restrictedAudience, { toolSurface: { version: 1, toolNames: [] } });
    expect(await verifyMcpSessionToken(token)).not.toBeNull();
    const listing = await (await POST(rpc(token, "tools/list"))).json();
    expect(listing.result.tools).toEqual([]);
  });

  it("executes the unchanged named old verifier and proves rollback rejects the new-only audience", async () => {
    const oldSource = readFileSync(new URL("../mcp/__fixtures__/session-token.95d97469.ts.txt", import.meta.url), "utf8");
    expect(createHash("sha256").update(oldSource).digest("hex"))
      .toBe("d5efe21093c1f706a8495129d4f413c369b97cd3a45826030caaff86909f70c7");
    const compiled = ts.transpileModule(oldSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const exports: { verifyMcpSessionToken?: typeof verifyMcpSessionToken } = {};
    runInNewContext(compiled, { exports, TextEncoder, process: { env: { AUTH_SECRET: signingSecret } }, console,
      require: (name: string) => {
        if (name === "jose") return jose;
        if (name === "@/lib/shared/task-execution-fence") return { parseTaskExecutionFence };
        throw new Error(`Unexpected legacy fixture dependency: ${name}`);
      } });
    const surface = { toolSurface: { version: 1, toolNames: [writer] } };
    // Real negative controls: old/dual audiences are accepted and silently
    // discard the surface. Merely adding a signed claim would be unsafe.
    for (const audience of [ordinaryAudience, [ordinaryAudience, restrictedAudience]]) {
      const accepted = await exports.verifyMcpSessionToken!(await syntheticSigned(audience, surface));
      expect(accepted!.scopes).toContain("file_read");
      expect(accepted).not.toHaveProperty("toolSurface");
    }
    expect(await exports.verifyMcpSessionToken!(await syntheticSigned(restrictedAudience, surface))).toBeNull();
    expect(await exports.verifyMcpSessionToken!(await nativeToken(["initiative_evidence_write", "file_read"]))).toBeNull();
  });
});
