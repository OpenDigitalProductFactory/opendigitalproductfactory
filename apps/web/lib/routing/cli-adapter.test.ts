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
vi.mock("@/lib/build/sandbox/agent-cli-runtime", () => ({
  writeSandboxFile: (...args: unknown[]) => mockWriteSandboxFile(...args),
}));

import {
  cliAdapter,
  CLAUDE_CODE_NATIVE_TOOLS_FLAG_VALUE,
  extractMentionedPlatformToolNames,
  parseCliJsonOutput,
  parseCliStreamOutput,
} from "./cli-adapter";

// The (path, content, mode, chownNodeUser) each writeSandboxFile call received.
type SandboxWriteParams = { path: string; content: string; mode?: string; chownNodeUser?: boolean };
function sandboxWriteFor(pathSubstring: string): SandboxWriteParams | undefined {
  return mockWriteSandboxFile.mock.calls
    .map((c) => c[0] as unknown as SandboxWriteParams)
    .find((p) => p.path.includes(pathSubstring));
}
import { InferenceError } from "@/lib/ai-inference";
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

// ── Tests ───────────────────────────────────────────────────────────────────

describe("cliAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
    mockWriteSandboxFile.mockResolvedValue(undefined);
  });

  it("has type 'claude-cli'", () => {
    expect(cliAdapter.type).toBe("claude-cli");
  });

  it("recognizes code graph tool mentions in CLI trace output", () => {
    expect(
      extractMentionedPlatformToolNames(
        "Call get_code_graph_freshness, search_code_graph, trace_code_surface, and find_related_tests before review.",
      ),
    ).toEqual([
      "get_code_graph_freshness",
      "search_code_graph",
      "trace_code_surface",
      "find_related_tests",
    ]);
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

  it("reaps the in-sandbox process tree on dispatch timeout (BI-F36E7510)", async () => {
    vi.useFakeTimers();
    try {
      mockGetProviderBearerToken.mockResolvedValue({ token: "sk-ant-oat01-test" });

      // A hung dispatch: the spawned proc never emits "close" until we kill it.
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      mockSpawn.mockReturnValue(proc);

      const p = cliAdapter.execute(makeRequest());
      p.catch(() => {}); // prevent unhandled-rejection noise before we assert

      // Advance past CLI_TIMEOUT_MS — the dispatch timer fires.
      await vi.advanceTimersByTimeAsync(600_000);

      // The local docker-exec client is signalled...
      expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
      // ...AND the in-container tree is reaped (the actual fix): a docker exec
      // that SIGTERMs the recorded pid + the runner sh.
      const calls = mockExecAsync.mock.calls.map((c) => String(c[0]));
      const termReap = calls.find(
        (cmd) => /kill -TERM/.test(cmd) && /(cli-pid-|cli-run-)/.test(cmd),
      );
      expect(termReap).toBeDefined();

      // After the grace period it escalates to SIGKILL.
      await vi.advanceTimersByTimeAsync(3_000);
      const killReap = mockExecAsync.mock.calls
        .map((c) => String(c[0]))
        .some((cmd) => /kill -KILL/.test(cmd) && /(cli-pid-|cli-run-)/.test(cmd));
      expect(killReap).toBe(true);

      // The wrapper dies → the dispatch rejects as a timeout.
      proc.emit("close", null);
      await expect(p).rejects.toThrow(/timed out/i);
    } finally {
      vi.useRealTimers();
    }
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

    // The system prompt file should include tool descriptions. Verify via the
    // captured writeSandboxFile content (streamed to the sandbox via stdin).
    const systemWrite = sandboxWriteFor("cli-system-");
    expect(systemWrite).toBeDefined();
    expect(systemWrite!.content).toContain("create_backlog_item");
  });

  // BI-35FAE2DB: `claude` discovers CLAUDE.md (which imports the whole
  // AGENTS.md rulebook), project settings and hooks by walking UP from its
  // working directory. Running headless inference in /workspace turned every
  // single-shot call into an agentic session that answered a "respond with
  // ONLY a JSON object" prompt with session meta-commentary, which the review
  // parser cannot read — Build Studio design review reported "Both review
  // agents failed to respond" for 332 rounds because of it.
  it("runs the CLI from a neutral directory, never the project workspace", async () => {
    mockGetProviderBearerToken.mockResolvedValue({ token: "sk-ant-oat01-test-token" });
    const cliOutput = JSON.stringify({ result: "OK", usage: {} });
    mockSpawn.mockReturnValue(createMockProcess(cliOutput));

    await cliAdapter.execute(makeRequest());

    const decodedScript = sandboxWriteFor("cli-run-")!.content;

    // The regression itself: never cd into the project tree.
    expect(decodedScript).not.toContain("cd /workspace");
    // An empty per-run directory, created before use so `cd` cannot fail.
    expect(decodedScript).toMatch(/mkdir -p \/tmp\/cli-cwd-/);
    expect(decodedScript).toMatch(/cd \/tmp\/cli-cwd-/);
    // Order matters: mkdir must precede cd.
    expect(decodedScript.indexOf("mkdir -p /tmp/cli-cwd-"))
      .toBeLessThan(decodedScript.indexOf("cd /tmp/cli-cwd-"));
  });

  it("removes the neutral working directory when the call is cleaned up", async () => {
    mockGetProviderBearerToken.mockResolvedValue({ token: "sk-ant-oat01-test-token" });
    const cliOutput = JSON.stringify({ result: "OK", usage: {} });
    mockSpawn.mockReturnValue(createMockProcess(cliOutput));

    await cliAdapter.execute(makeRequest());

    const cleanup = mockExecAsync.mock.calls
      .map((c) => String(c[0]))
      .find((cmd) => /rmdir \/tmp\/cli-cwd-/.test(cmd));
    expect(cleanup).toBeDefined();
    // Cleanup must never fail the call — the dir may already be gone.
    expect(cleanup).toContain("|| true");
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

  it("classifies Claude CLI 529 overloaded stderr as overload", async () => {
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
      proc.stderr.emit("data", Buffer.from("API Error: 529 Overloaded. This is a server-side issue."));
      proc.emit("close", 1);
    }, 10);

    mockSpawn.mockReturnValue(proc);

    await expect(cliAdapter.execute(makeRequest())).rejects.toMatchObject({
      code: "overloaded",
      providerId: "anthropic-sub",
    } satisfies Partial<InferenceError>);
  });

  it("classifies Claude CLI 529 overloaded stdout as overload", async () => {
    mockGetProviderBearerToken.mockResolvedValue({
      token: "sk-ant-oat01-test-token",
    });

    const cliOutput = JSON.stringify({
      result: "API Error\nAPI Error: 529 Overloaded. This is a server-side issue, usually temporary.",
      usage: {},
    });
    mockSpawn.mockReturnValue(createMockProcess(cliOutput));

    await expect(cliAdapter.execute(makeRequest())).rejects.toMatchObject({
      code: "overloaded",
      providerId: "anthropic-sub",
    } satisfies Partial<InferenceError>);
  });

  it("disables Claude Code's native tools via --disallowedTools (BI-931303FF regression)", async () => {
    // Without this flag, Claude Code's built-in tools (Read, Write, Bash,
    // Agent, etc.) shadow the platform's MCP-style tools that the agentic
    // loop dispatches. The model preferentially emits native tool_use for
    // its own tools and the platform tool descriptions in the system prompt
    // are ignored — Build Studio coworkers hallucinated success without ever
    // actually saving evidence. See BI-931303FF.
    mockGetProviderBearerToken.mockResolvedValue({
      token: "sk-ant-oat01-test-token",
    });

    const cliOutput = JSON.stringify({ result: "OK", usage: {} });
    mockSpawn.mockReturnValue(createMockProcess(cliOutput));

    await cliAdapter.execute(makeRequest());

    // Find the runner-script write — path has cli-run-…; the script body is the
    // `content` streamed to the sandbox via stdin (never in a command string).
    const runnerWrite = sandboxWriteFor("cli-run-");
    expect(runnerWrite).toBeDefined();
    const decodedScript = runnerWrite!.content;

    expect(decodedScript).toContain("--disallowedTools");
    expect(decodedScript).toContain(CLAUDE_CODE_NATIVE_TOOLS_FLAG_VALUE);
    // Spot-check critical names so a future refactor that drops one of
    // these (e.g. only blocks Bash) is caught — these are the highest-risk
    // shadowing tools.
    for (const critical of ["Read", "Write", "Edit", "Bash", "Agent", "Skill"]) {
      expect(decodedScript).toContain(critical);
    }
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

  // ── Native-MCP mode ────────────────────────────────────────────────────────
  // When the agentic loop populates `mcpSession` AND the call has tools, the
  // adapter mints a per-call JWT, writes an mcp-config.json, and tells the CLI
  // to mount /api/mcp/v1 via --mcp-config. Tools no longer get described in
  // text; the CLI surfaces them as native mcp__dpf__* tool_use definitions and
  // dispatches them through the MCP server. This is the post-#516 architecture.
  describe("native-MCP mode", () => {
    function makeMcpRequest(): AdapterRequest {
      return makeRequest({
        tools: [
          {
            type: "function",
            function: {
              name: "query_backlog",
              description: "Query the backlog",
              parameters: { type: "object", properties: {} },
            },
          },
          {
            type: "function",
            function: {
              name: "create_backlog_item",
              description: "Create a backlog item",
              parameters: { type: "object", properties: { title: { type: "string" } } },
            },
          },
        ],
        mcpSession: {
          userId: "user-1",
          agentId: "build-specialist",
          threadId: "thread-abc",
          routeContext: "/build",
        },
      });
    }

    it("mints a session JWT and writes an mcp-config when mcpSession + tools present", async () => {
      mockGetProviderBearerToken.mockResolvedValue({ token: "sk-ant-oat01-x" });
      mockCreateMcpSessionToken.mockResolvedValue("eyJ.test.jwt");
      mockSpawn.mockReturnValue(createMockProcess(JSON.stringify({ result: "ok", usage: {} })));

      await cliAdapter.execute(makeMcpRequest());

      expect(mockCreateMcpSessionToken).toHaveBeenCalledTimes(1);
      const mintArgs = mockCreateMcpSessionToken.mock.calls[0]![0] as Record<string, unknown>;
      expect(mintArgs.userId).toBe("user-1");
      expect(mintArgs.agentId).toBe("build-specialist");
      expect(mintArgs.threadId).toBe("thread-abc");
      expect(mintArgs.routeContext).toBe("/build");
      expect(mintArgs.capability).toBe("write"); // create_backlog_item is side-effecting
      expect(mintArgs.scopes).toContain("backlog_read");
      expect(mintArgs.scopes).toContain("backlog_write");

      // mcp-config file write — chown to the node user + chmod 644 so the Claude
      // CLI process can read the config. These are now params to writeSandboxFile
      // (the JWT-bearing content flows via stdin, never the command surface).
      const mcpWrite = sandboxWriteFor("cli-mcp-");
      expect(mcpWrite).toBeDefined();
      expect(mcpWrite!.chownNodeUser).toBe(true);
      expect(mcpWrite!.mode).toBe("644");
      // The short-lived JWT is carried in the config content, not in argv.
      expect(mcpWrite!.content).toContain("eyJ.test.jwt");
    });

    it("includes --mcp-config + --strict-mcp-config in the runner script", async () => {
      mockGetProviderBearerToken.mockResolvedValue({ token: "sk-ant-oat01-x" });
      mockCreateMcpSessionToken.mockResolvedValue("eyJ.test.jwt");
      mockSpawn.mockReturnValue(createMockProcess(JSON.stringify({ result: "ok", usage: {} })));

      await cliAdapter.execute(makeMcpRequest());

      const decoded = sandboxWriteFor("cli-run-")!.content;

      expect(decoded).toContain("--mcp-config");
      expect(decoded).toContain("--strict-mcp-config");
      // Native-tool shadowing backstop is still in place
      expect(decoded).toContain("--disallowedTools");
      expect(decoded).toContain(CLAUDE_CODE_NATIVE_TOOLS_FLAG_VALUE);
    });

    it("does NOT inject the text-described tool list into the system prompt", async () => {
      mockGetProviderBearerToken.mockResolvedValue({ token: "sk-ant-oat01-x" });
      mockCreateMcpSessionToken.mockResolvedValue("eyJ.test.jwt");
      mockSpawn.mockReturnValue(createMockProcess(JSON.stringify({ result: "ok", usage: {} })));

      await cliAdapter.execute(makeMcpRequest());

      const sys = sandboxWriteFor("cli-system-")!.content;

      // Tool descriptions and the structured-JSON wire-format contract must
      // be absent — the CLI advertises tools via MCP discovery.
      expect(sys).not.toContain("To invoke a tool");
      expect(sys).not.toContain("query_backlog: Query the backlog");
    });

    it("falls back to legacy text-tool mode when JWT minting fails", async () => {
      mockGetProviderBearerToken.mockResolvedValue({ token: "sk-ant-oat01-x" });
      mockCreateMcpSessionToken.mockRejectedValue(new Error("AUTH_SECRET missing"));
      mockSpawn.mockReturnValue(createMockProcess(JSON.stringify({ result: "ok", usage: {} })));

      await cliAdapter.execute(makeMcpRequest());

      const decoded = sandboxWriteFor("cli-run-")!.content;
      expect(decoded).not.toContain("--mcp-config");
      expect(decoded).toContain("--disallowedTools"); // legacy path still suppresses native tools

      const sys = sandboxWriteFor("cli-system-")!.content;
      // Legacy text-tool injection is back when the mint fails
      expect(sys).toContain("To invoke a tool");
    });

    it("falls back to legacy mode when mcpSession is absent", async () => {
      mockGetProviderBearerToken.mockResolvedValue({ token: "sk-ant-oat01-x" });
      mockSpawn.mockReturnValue(createMockProcess(JSON.stringify({ result: "ok", usage: {} })));

      // Same tools as makeMcpRequest, but no mcpSession — eval runner / non-coworker case.
      await cliAdapter.execute(
        makeRequest({
          tools: [
            {
              type: "function",
              function: { name: "query_backlog", description: "Q", parameters: {} },
            },
          ],
        }),
      );

      expect(mockCreateMcpSessionToken).not.toHaveBeenCalled();
      const runnerWrite = sandboxWriteFor("cli-run-");
      expect(runnerWrite).toBeDefined();
      expect(runnerWrite!.content).not.toContain("--mcp-config");
    });

    it("derives capability=read when no tools require write grants", async () => {
      mockGetProviderBearerToken.mockResolvedValue({ token: "sk-ant-oat01-x" });
      mockCreateMcpSessionToken.mockResolvedValue("eyJ.test.jwt");
      mockSpawn.mockReturnValue(createMockProcess(JSON.stringify({ result: "ok", usage: {} })));

      await cliAdapter.execute(
        makeRequest({
          tools: [
            {
              type: "function",
              function: { name: "query_backlog", description: "Q", parameters: {} },
            },
            {
              type: "function",
              function: { name: "list_epics", description: "E", parameters: {} },
            },
          ],
          mcpSession: { userId: "user-1", agentId: "x", threadId: "y", routeContext: "/" },
        }),
      );

      const mintArgs = mockCreateMcpSessionToken.mock.calls[0]![0] as Record<string, unknown>;
      expect(mintArgs.capability).toBe("read");
      expect(mintArgs.scopes).toEqual(expect.arrayContaining(["backlog_read"]));
    });

    it("cleanup includes the mcp-config file", async () => {
      mockGetProviderBearerToken.mockResolvedValue({ token: "sk-ant-oat01-x" });
      mockCreateMcpSessionToken.mockResolvedValue("eyJ.test.jwt");
      mockSpawn.mockReturnValue(createMockProcess(JSON.stringify({ result: "ok", usage: {} })));

      await cliAdapter.execute(makeMcpRequest());

      const execCalls = mockExecAsync.mock.calls.map((c) => c[0] as string);
      const cleanup = execCalls.find((c) => c.includes("rm -f"));
      expect(cleanup).toContain("cli-mcp-");
    });

    it("strips mcp__dpf__* tool_use blocks the CLI surfaces (Phase 6 double-dispatch protection)", async () => {
      mockGetProviderBearerToken.mockResolvedValue({ token: "sk-ant-oat01-x" });
      mockCreateMcpSessionToken.mockResolvedValue("eyJ.test.jwt");

      // Hypothetical case: CLI dispatched mcp__dpf__query_backlog internally
      // but also leaves an unresolved tool_use block in the output. The
      // adapter must NOT pass that to the agentic loop or it would re-execute.
      const cliOutput = JSON.stringify({
        result: "Found 64 open items.",
        content: [
          { type: "text", text: "Done" },
          {
            type: "tool_use",
            id: "tool_999",
            name: "mcp__dpf__query_backlog",
            input: { limit: 5 },
          },
          // A non-MCP tool_use should still pass through (legacy callers still
          // rely on this — e.g. nudge prompts asking the model to make ONE call).
          {
            type: "tool_use",
            id: "tool_1000",
            name: "save_build_notes",
            input: { notes: "x" },
          },
        ],
        usage: {},
      });
      mockSpawn.mockReturnValue(createMockProcess(cliOutput));

      const result = await cliAdapter.execute(makeMcpRequest());
      expect(result.toolCalls.map((tc) => tc.name)).toEqual(["save_build_notes"]);
    });
  });
});

// ── CLI parser tests (Phase J fix: surface mcp__dpf__ pre-executed names) ──
//
// Regression coverage for the false-positive NO-CALL-BUT-MENTIONED tracer.
// When the CLI MCP client already executed an mcp__dpf__* call before we
// parsed the output, the parser strips it from `toolCalls` (correctly, to
// avoid double-execution) but used to drop the name on the floor. The trace
// then logged "agent mentioned a tool but didn't call it" when the agent's
// post-execution narration referenced the tool name in chat. That signal
// misled the Phase J Dale dogfood troubleshooter into blaming the model.
//
// These tests pin the contract: cliPreExecutedNames is populated with the
// stripped-prefix names so the trace can subtract them from "mentioned".

describe("parseCliStreamOutput", () => {
  it("captures mcp__dpf__ tool names as cliPreExecutedNames (stream)", () => {
    const stream = [
      '{"type":"assistant","content":"I will file a quality issue."}',
      '{"type":"tool_use","id":"x1","name":"mcp__dpf__report_quality_issue","input":{"title":"t","type":"feedback"}}',
      '{"type":"result","result":"done","usage":{"input_tokens":5,"output_tokens":10}}',
    ].join("\n");

    const parsed = parseCliStreamOutput(stream);

    // The structured tool_use was an MCP-pre-executed call. It must NOT
    // appear in toolCalls (no re-dispatch) but MUST appear in the
    // pre-executed names list (so the trace can suppress ghosts).
    expect(parsed.toolCalls).toEqual([]);
    expect(parsed.cliPreExecutedNames).toEqual(["report_quality_issue"]);
  });

  it("keeps non-MCP tool calls in toolCalls (stream)", () => {
    const stream = [
      '{"type":"tool_use","id":"x2","name":"saveBuildEvidence","input":{"field":"buildPlan"}}',
      '{"type":"result","result":"saved","usage":{}}',
    ].join("\n");

    const parsed = parseCliStreamOutput(stream);
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls[0]?.name).toBe("saveBuildEvidence");
    expect(parsed.cliPreExecutedNames).toEqual([]);
  });
});

describe("parseCliJsonOutput", () => {
  it("captures mcp__dpf__ tool names as cliPreExecutedNames (json)", () => {
    const output = JSON.stringify({
      result: "Filed the issue.",
      content: [
        {
          type: "tool_use",
          id: "x1",
          name: "mcp__dpf__report_quality_issue",
          input: { title: "t", type: "feedback" },
        },
      ],
      usage: { input_tokens: 5, output_tokens: 10 },
    });

    const parsed = parseCliJsonOutput(output);
    expect(parsed.toolCalls).toEqual([]);
    expect(parsed.cliPreExecutedNames).toEqual(["report_quality_issue"]);
  });

  it("returns empty cliPreExecutedNames when no MCP calls fired (json)", () => {
    const output = JSON.stringify({
      result: "Hello",
      content: [
        {
          type: "tool_use",
          id: "x2",
          name: "saveBuildEvidence",
          input: { field: "designDoc" },
        },
      ],
      usage: {},
    });

    const parsed = parseCliJsonOutput(output);
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls[0]?.name).toBe("saveBuildEvidence");
    expect(parsed.cliPreExecutedNames).toEqual([]);
  });

  it("returns empty cliPreExecutedNames on raw non-JSON output (json)", () => {
    // Non-JSON raw output (e.g. CLI printed an error string) should not
    // crash the new field — it must default to [].
    const parsed = parseCliJsonOutput("plain error text, not JSON");
    expect(parsed.cliPreExecutedNames).toEqual([]);
  });
});
