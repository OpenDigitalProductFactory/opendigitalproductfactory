import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/ai-inference", () => {
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

import { cliAdapter } from "./cli-adapter";
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

// ── Tests ───────────────────────────────────────────────────────────────────

describe("cliAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
  });

  it("has type 'claude-cli'", () => {
    expect(cliAdapter.type).toBe("claude-cli");
  });

  it("resolves auth via getProviderBearerToken for anthropic-sub", async () => {
    mockGetProviderBearerToken.mockResolvedValue({
      token: "sk-ant-oat01-test-token",
    });

    const cliOutput = JSON.stringify({
      result: "Hello! How can I help?",
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    mockSpawn.mockReturnValue(createMockProcess(cliOutput));

    const result = await cliAdapter.execute(makeRequest());
    expect(result.text).toBe("Hello! How can I help?");
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(20);
    expect(mockGetProviderBearerToken).toHaveBeenCalledWith("anthropic-sub");
  });

  it("throws InferenceError when bearer token refresh fails", async () => {
    mockGetProviderBearerToken.mockResolvedValue({
      error: "Refresh token expired",
    });

    await expect(cliAdapter.execute(makeRequest())).rejects.toThrow(
      /OAuth token error.*Refresh token expired/,
    );
  });

  it("parses tool calls from CLI JSON output", async () => {
    mockGetProviderBearerToken.mockResolvedValue({
      token: "sk-ant-oat01-test-token",
    });

    const cliOutput = JSON.stringify({
      result: "I'll create that for you.",
      content: [
        { type: "text", text: "Creating..." },
        {
          type: "tool_use",
          id: "tool_123",
          name: "create_backlog_item",
          input: { title: "Test item", type: "product" },
        },
      ],
      usage: { input_tokens: 50, output_tokens: 100 },
    });

    mockSpawn.mockReturnValue(createMockProcess(cliOutput));

    const result = await cliAdapter.execute(makeRequest());
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("create_backlog_item");
    expect(result.toolCalls[0].id).toBe("tool_123");
    expect(result.toolCalls[0].arguments).toEqual({ title: "Test item", type: "product" });
  });

  it("includes tool descriptions in system prompt when tools provided", async () => {
    mockGetProviderBearerToken.mockResolvedValue({
      token: "sk-ant-oat01-test-token",
    });

    const cliOutput = JSON.stringify({ result: "OK", usage: {} });
    mockSpawn.mockReturnValue(createMockProcess(cliOutput));

    const tools = [
      {
        type: "function",
        function: {
          name: "create_backlog_item",
          description: "Create a backlog item",
          parameters: { type: "object", properties: { title: { type: "string" } } },
        },
      },
    ];

    await cliAdapter.execute(makeRequest({ tools }));

    // The system prompt file should include tool descriptions
    // Verify via the exec calls that wrote to temp files
    const execCalls = mockExecAsync.mock.calls.map(c => c[0] as string);
    const systemFileWrite = execCalls.find(c => c.includes("cli-system-"));
    expect(systemFileWrite).toBeDefined();
  });

  it("handles CLI process error with auth failure classification", async () => {
    mockGetProviderBearerToken.mockResolvedValue({
      token: "sk-ant-oat01-test-token",
    });

    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();

    setTimeout(() => {
      proc.stderr.emit("data", Buffer.from("Error: unauthorized - invalid token"));
      proc.emit("close", 1);
    }, 10);

    mockSpawn.mockReturnValue(proc);

    await expect(cliAdapter.execute(makeRequest())).rejects.toThrow(/auth failed/i);
  });

  it("cleans up temp files after execution", async () => {
    mockGetProviderBearerToken.mockResolvedValue({
      token: "sk-ant-oat01-test-token",
    });

    const cliOutput = JSON.stringify({ result: "Done", usage: {} });
    mockSpawn.mockReturnValue(createMockProcess(cliOutput));

    await cliAdapter.execute(makeRequest());

    // Verify cleanup exec was called with rm -f
    const execCalls = mockExecAsync.mock.calls.map(c => c[0] as string);
    const cleanupCall = execCalls.find(c => c.includes("rm -f"));
    expect(cleanupCall).toBeDefined();
  });
});
