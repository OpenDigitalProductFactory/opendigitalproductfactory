import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/routing/inference-error", () => {
  class InferenceError extends Error {
    name = "InferenceError";
    constructor(
      message: string,
      public readonly code: string,
      public readonly providerId: string,
    ) {
      super(message);
    }
  }
  return { InferenceError };
});

const mockGetDecryptedCredential = vi.fn();
const mockGetProviderBearerToken = vi.fn();
vi.mock("@/lib/inference/ai-provider-internals", () => ({
  getDecryptedCredential: (...args: unknown[]) => mockGetDecryptedCredential(...args),
  getProviderBearerToken: (...args: unknown[]) => mockGetProviderBearerToken(...args),
}));

const mockCreateMcpSessionToken = vi.fn();
vi.mock("@/lib/mcp/session-token", () => ({
  createMcpSessionToken: (...args: unknown[]) => mockCreateMcpSessionToken(...args),
}));

vi.mock("./execution-adapter-registry", () => ({
  registerExecutionAdapter: vi.fn(),
}));

// Mock child_process
const mockSpawn = vi.fn();
const mockExecAsync = vi.fn();
vi.mock("@/lib/shared/lazy-node", () => ({
  lazyChildProcess: () => ({
    exec: (
      cmd: string,
      _opts: unknown,
      cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
    ) => {
      const result = mockExecAsync(cmd);
      if (result instanceof Promise) {
        result
          .then((resolved: { stdout: string; stderr: string }) => cb(null, resolved))
          .catch((error: Error) => cb(error, { stdout: "", stderr: "" }));
      } else {
        cb(null, { stdout: "", stderr: "" });
      }
    },
    spawn: (...args: unknown[]) => mockSpawn(...args),
  }),
  lazyUtil: () => ({
    promisify:
      (fn: Function) =>
      (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          fn(...args, (err: Error | null, result: unknown) => {
            if (err) reject(err);
            else resolve(result);
          });
        }),
  }),
}));

// Sandbox file writer — the adapter delegates every temp-file / secret write to
// writeSandboxFile, which streams content via stdin (BI-AFEF038A). Mock it so we
// can assert on the (path, content, mode) it was handed WITHOUT the content ever
// touching a command string.
const mockWriteSandboxFile = vi.fn((..._args: unknown[]): Promise<void> => Promise.resolve());
const mockLedgerCount = vi.fn();
vi.mock("@dpf/db", () => ({ prisma: { toolExecution: { count: (...args: unknown[]) => mockLedgerCount(...args) } } }));
vi.mock("./cli-pool-status", () => ({ recordCliRateLimit: vi.fn(), clearCliRateLimit: vi.fn() }));
vi.mock("@/lib/build/sandbox/agent-cli-runtime", () => ({
  writeSandboxFile: (...args: unknown[]) => mockWriteSandboxFile(...args),
}));

import {
  cliAdapter,
} from "./cli-adapter";

import { recordCliRateLimit, clearCliRateLimit } from "./cli-pool-status";
import { NativeCliExecutionUncertainError } from "./cli-owned-runner";
import type { AdapterRequest } from "./adapter-types";
import type { RoutedExecutionPlan } from "./recipe-types";
import { EventEmitter } from "events";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makePlan(overrides?: Partial<RoutedExecutionPlan>): RoutedExecutionPlan {
  return {
    providerId: "anthropic-sub",
    modelId: "claude-sonnet-4-6",
    recipeId: null,
    contractFamily: "conversation",
    executionAdapter: "claude-cli",
    maxTokens: 4096,
    providerSettings: {},
    toolPolicy: {},
    responsePolicy: {},
    ...overrides,
  };
}

function makeRequest(overrides?: Partial<AdapterRequest>): AdapterRequest {
  return {
    providerId: "anthropic-sub",
    modelId: "claude-sonnet-4-6",
    plan: makePlan(),
    provider: { baseUrl: "cli://local", headers: {} },
    fetchImpl: globalThis.fetch,
    messages: [{ role: "user", content: "Hello" }],
    systemPrompt: "You are a helpful assistant.",
    ...overrides,
  };
}

function createMockProcess(stdout: string, exitCode = 0) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();

  // Emit data and close async
  setTimeout(() => {
    proc.stdout.emit("data", Buffer.from(stdout));
    proc.emit("close", exitCode);
  }, 10);

  return proc;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
  mockWriteSandboxFile.mockResolvedValue(undefined);
  vi.mocked(recordCliRateLimit).mockReset();
});

describe("native quota observations preserve execution uncertainty", () => {
    const quota = { type: "result", subtype: "success", is_error: true,
      result: "You've hit your usage limit. PRIVATE-OUTPUT try again in 99 hours" };
    const request = () => makeRequest({
      plan: makePlan({ providerConnectionId: "subscription-team" }),
      mcpSession: { userId: "user-1", agentId: "build-specialist", threadId: "held-task" },
      tools: [{ type: "function", function: { name: "query_backlog", description: "Query", parameters: {} } }],
    });
    beforeEach(() => {
      mockGetProviderBearerToken.mockResolvedValue({ token: "fake-oauth-token" });
      mockCreateMcpSessionToken.mockResolvedValue("test-native-session");
    });
    it.each([0, 1])("records bounded safe quota once before rejecting native exit %s", async code => {
      let release!: () => void;
      vi.mocked(recordCliRateLimit).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
      mockSpawn.mockReturnValue(createMockProcess(JSON.stringify(quota), code));
      let settled = false;
      const result = cliAdapter.execute(request()).catch(error => { settled = true; return error; });
      await vi.waitFor(() => expect(recordCliRateLimit).toHaveBeenCalledOnce());
      expect(settled).toBe(false);
      expect(recordCliRateLimit).toHaveBeenCalledWith("claude-cli", "anthropic-sub",
        "The native CLI reported a usage limit; its reset time is unknown.",
        { providerId: "anthropic-sub", providerConnectionId: "subscription-team" });
      release();
      const error = await result;
      expect(error).toBeInstanceOf(NativeCliExecutionUncertainError);
      expect(error.diagnostics).toMatchObject({ exitCode: code, childProcessClosure: "unverified",
        terminalResult: { type: "result", status: "error", isError: true, hint: "quota" } });
      expect(clearCliRateLimit).not.toHaveBeenCalled();
      expect(mockSpawn).toHaveBeenCalledOnce();
    });
    it.each([0, 1])("keeps the execution held if quota persistence rejects after exit %s", async code => {
      vi.mocked(recordCliRateLimit).mockRejectedValueOnce(new Error("store unavailable"));
      mockSpawn.mockReturnValue(createMockProcess(JSON.stringify(quota), code));
      await expect(cliAdapter.execute(request())).rejects.toMatchObject({ name: "NativeCliExecutionUncertainError",
        providerId: "anthropic-sub", diagnostics: { terminalResult: { hint: "quota" } } });
      expect(recordCliRateLimit).toHaveBeenCalledOnce();
      expect(clearCliRateLimit).not.toHaveBeenCalled();
      expect(mockSpawn).toHaveBeenCalledOnce();
    });
    it.each([
      "You've hit your usage limit",
      JSON.stringify({ ...quota, is_error: false }),
      JSON.stringify({ ...quota, type: "assistant" }),
      JSON.stringify({ ...quota, errors: ["untrusted payload"] }),
      JSON.stringify({ ...quota, result: "Authentication failed" }),
    ])("does not turn untrusted or nonquota output into quota evidence: %s", async output => {
      mockSpawn.mockReturnValue(createMockProcess(output, 1));
      await expect(cliAdapter.execute(request())).rejects.toBeInstanceOf(NativeCliExecutionUncertainError);
      expect(recordCliRateLimit).not.toHaveBeenCalled();
      expect(clearCliRateLimit).not.toHaveBeenCalled();
    });
  });

describe("BI-29BB23F5: a self-terminated native error with an empty governed ledger is settled", () => {
  const quota = { type: "result", subtype: "success", is_error: true, result: "You've hit your weekly limit · resets 2am" };
  const request = (taskRunId?: string) => makeRequest({
    mcpSession: { userId: "user-1", agentId: "build-specialist", threadId: "thread-1", ...(taskRunId ? { taskRunId } : {}) },
    tools: [{ type: "function", function: { name: "record_workroom_evidence", description: "Record", parameters: {} } }],
  });
  beforeEach(() => {
    mockGetProviderBearerToken.mockResolvedValue({ token: "fake-oauth-token" });
    mockCreateMcpSessionToken.mockResolvedValue("test-native-session");
    mockLedgerCount.mockReset();
  });
  it("raises a rate limit so fallback can continue the same run", async () => {
    mockLedgerCount.mockResolvedValue(0);
    mockSpawn.mockReturnValue(createMockProcess(JSON.stringify(quota), 1));
    const error = await cliAdapter.execute(request("TR-SCHED-B3D332F3")).catch(e => e);
    expect(error).not.toBeInstanceOf(NativeCliExecutionUncertainError);
    expect(error).toMatchObject({ name: "InferenceError", code: "rate_limit", providerId: "anthropic-sub" });
    expect(recordCliRateLimit).toHaveBeenCalledOnce();
    expect(mockLedgerCount).toHaveBeenCalledOnce();
  });
  it("keeps the hold when the governed ledger recorded a call", async () => {
    mockLedgerCount.mockResolvedValue(2);
    mockSpawn.mockReturnValue(createMockProcess(JSON.stringify(quota), 1));
    await expect(cliAdapter.execute(request("TR-SCHED-B3D332F3"))).rejects.toBeInstanceOf(NativeCliExecutionUncertainError);
  });
  it("keeps the hold without a TaskRun", async () => {
    mockSpawn.mockReturnValue(createMockProcess(JSON.stringify(quota), 1));
    await expect(cliAdapter.execute(request())).rejects.toBeInstanceOf(NativeCliExecutionUncertainError);
    expect(mockLedgerCount).not.toHaveBeenCalled();
  });
});
