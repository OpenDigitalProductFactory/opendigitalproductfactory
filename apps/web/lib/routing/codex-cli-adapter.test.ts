// apps/web/lib/routing/codex-cli-adapter.test.ts
// Tests for codex-cli-adapter — focusing on the stdin-pipe fix for BI-2685C1E5
// and E2BIG spawn error classification.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// ── Mocks ────────────────────────────────────────────────────────────────────

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

vi.mock("@/lib/inference/ai-provider-internals", () => ({
  getDecryptedCredential: vi.fn(),
  getProviderBearerToken: vi.fn(),
}));

vi.mock("./execution-adapter-registry", () => ({
  registerExecutionAdapter: vi.fn(),
}));

vi.mock("./extract-tool-calls", () => ({
  extractToolCalls: vi.fn().mockReturnValue([]),
}));

// ── Spawn mock infrastructure ─────────────────────────────────────────────────

interface MockProcess extends EventEmitter {
  stdin: {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

function makeMockProcess(): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdin = {
    write: vi.fn((_data: unknown, cb?: (err?: Error | null) => void) => {
      cb?.();
      return true;
    }),
    end: vi.fn(),
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

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

import {
  writeContainerFileViaStdin,
  looksLikeCliAuthFailure,
  looksLikeCliRateLimit,
} from "./codex-cli-adapter";
import type { AdapterRequest } from "./adapter-types";
import type { RoutedExecutionPlan } from "./recipe-types";

// ── Request factory (mirrors cli-adapter.test.ts pattern) ────────────────────

function makePlan(overrides?: Partial<RoutedExecutionPlan>): RoutedExecutionPlan {
  return {
    providerId: "codex",
    modelId: "gpt-4o",
    recipeId: null,
    contractFamily: "conversation",
    executionAdapter: "codex-cli",
    maxTokens: 4096,
    providerSettings: {},
    toolPolicy: {},
    responsePolicy: {},
    ...overrides,
  };
}

function makeRequest(overrides?: Partial<AdapterRequest>): AdapterRequest {
  return {
    providerId: "codex",
    modelId: "gpt-4o",
    plan: makePlan(),
    provider: { baseUrl: "cli://local", headers: {} },
    fetchImpl: globalThis.fetch,
    messages: [{ role: "user", content: "hello" }],
    systemPrompt: "",
    ...overrides,
  };
}

// ── writeContainerFileViaStdin ────────────────────────────────────────────────

describe("writeContainerFileViaStdin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses docker exec -i (stdin pipe) — NOT echo arg injection", async () => {
    const proc = makeMockProcess();
    mockSpawn.mockReturnValue(proc);

    const writePromise = writeContainerFileViaStdin("aGVsbG8=", "/tmp/test.txt");
    proc.emit("close", 0);
    await writePromise;

    const [cmd, args] = mockSpawn.mock.calls[0] as [string, string[]];
    expect(cmd).toBe("docker");
    // -i flag is required for stdin piping
    expect(args).toContain("-i");
    // The base64 payload must NEVER appear in the command arguments —
    // that is the exact bug BI-2685C1E5: large payloads hit OS ARG_MAX.
    expect(args.join(" ")).not.toContain("aGVsbG8=");
  });

  it("sends b64 data through stdin.write, then calls stdin.end", async () => {
    const proc = makeMockProcess();
    mockSpawn.mockReturnValue(proc);

    const writePromise = writeContainerFileViaStdin("aGVsbG8=", "/tmp/test.txt");
    proc.emit("close", 0);
    await writePromise;

    expect(proc.stdin.write).toHaveBeenCalledWith("aGVsbG8=", expect.any(Function));
    expect(proc.stdin.end).toHaveBeenCalled();
  });

  it("applies the specified chmod mode in the container sh -c command", async () => {
    const proc = makeMockProcess();
    mockSpawn.mockReturnValue(proc);

    const writePromise = writeContainerFileViaStdin("dGVzdA==", "/tmp/run.sh", "755");
    proc.emit("close", 0);
    await writePromise;

    const shCmd = (mockSpawn.mock.calls[0] as [string, string[]])[1].join(" ");
    expect(shCmd).toContain("chmod 755");
  });

  it("rejects when docker exits with non-zero code", async () => {
    const proc = makeMockProcess();
    mockSpawn.mockReturnValue(proc);

    const writePromise = writeContainerFileViaStdin("dGVzdA==", "/tmp/fail.txt");
    proc.stderr.emit("data", Buffer.from("permission denied"));
    proc.emit("close", 1);

    await expect(writePromise).rejects.toThrow("Container file write failed");
  });

  it("rejects on spawn-level error (e.g. docker not found)", async () => {
    const proc = makeMockProcess();
    mockSpawn.mockReturnValue(proc);

    const writePromise = writeContainerFileViaStdin("dGVzdA==", "/tmp/fail.txt");
    proc.emit("error", new Error("spawn ENOENT"));

    await expect(writePromise).rejects.toThrow("spawn ENOENT");
  });

  it("kills the process and rejects after the 10 s write timeout", async () => {
    const proc = makeMockProcess();
    mockSpawn.mockReturnValue(proc);

    const writePromise = writeContainerFileViaStdin("dGVzdA==", "/tmp/slow.txt");

    vi.advanceTimersByTime(11_000);

    await expect(writePromise).rejects.toThrow("timed out");
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("does not double-reject when both timeout and close fire", async () => {
    const proc = makeMockProcess();
    mockSpawn.mockReturnValue(proc);

    const writePromise = writeContainerFileViaStdin("dGVzdA==", "/tmp/double.txt");

    vi.advanceTimersByTime(11_000);
    // Subsequent close or error must be silently swallowed by the settled flag
    proc.emit("close", 1);

    await expect(writePromise).rejects.toThrow("timed out");
  });
});

// ── E2BIG spawn error classification ─────────────────────────────────────────

describe("codexCliAdapter — E2BIG spawn error classification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Runs execute() with a mock where:
   *  - auth returns apikey mode (no file write)
   *  - the first two spawns (prompt + runner file writes) succeed immediately
   *  - the third spawn (the actual codex exec) emits the given error
   */
  async function runAndGetSpawnErrorCode(spawnErrMsg: string): Promise<string> {
    const { getDecryptedCredential } = await import("@/lib/inference/ai-provider-internals");
    vi.mocked(getDecryptedCredential).mockResolvedValue({
      secretRef: "sk-test",
      cachedToken: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    let spawnCallCount = 0;
    mockSpawn.mockImplementation(() => {
      spawnCallCount++;
      const proc = makeMockProcess();
      if (spawnCallCount <= 2) {
        // Prompt + runner file writes — succeed synchronously on nextTick
        process.nextTick(() => proc.emit("close", 0));
      } else {
        // The actual codex exec spawn fails with the given error
        process.nextTick(() => proc.emit("error", new Error(spawnErrMsg)));
      }
      return proc;
    });

    // execAsync for archive copy and cleanup — succeed silently
    mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });

    const { codexCliAdapter } = await import("./codex-cli-adapter");
    try {
      await codexCliAdapter.execute(makeRequest());
      return "no-error";
    } catch (err: unknown) {
      return (err as { code?: string }).code ?? "unknown";
    }
  }

  it("classifies ENOMEM (typical E2BIG surface) as request_too_large", async () => {
    expect(await runAndGetSpawnErrorCode("spawn ENOMEM")).toBe("request_too_large");
  });

  it("classifies 'argument list too long' as request_too_large", async () => {
    expect(await runAndGetSpawnErrorCode("argument list too long")).toBe("request_too_large");
  });

  it("classifies ENOENT (docker not found) as network", async () => {
    expect(await runAndGetSpawnErrorCode("spawn ENOENT")).toBe("network");
  });

  it("classifies ECONNREFUSED as network", async () => {
    expect(await runAndGetSpawnErrorCode("spawn ECONNREFUSED")).toBe("network");
  });
});

// ── Auth-vs-rate classification (routing-resilience spec D2) ─────────────────
// An expired OAuth token must classify as `auth` (→ provider disable + reconnect
// surfacing) even when the CLI also emits throttle-looking text, so the fallback
// chain does not loop on a 30s wait against a provider that cannot succeed.
describe("looksLikeCliAuthFailure", () => {
  it.each([
    "Not logged in",
    "ERROR: unexpected status 401 Unauthorized: Missing bearer",
    "Re-authentication required. Re-authenticate via Admin > AI Workforce.",
    "reauthenticate to continue",
    "Please log in to continue",
    "session expired",
    "your token has expired",
    "not authenticated",
    "Invalid API key · Fix external API key",
  ])("classifies %j as an auth failure", (text) => {
    expect(looksLikeCliAuthFailure(text)).toBe(true);
  });

  it.each([
    "Codex CLI rate limited: Reading prompt from stdin...",
    "429 Too Many Requests",
    "Reading prompt from stdin...",
    "model produced an empty response",
  ])("does NOT classify pure rate-limit/other text %j as auth", (text) => {
    expect(looksLikeCliAuthFailure(text)).toBe(false);
  });

  it("treats re-auth text as auth even when throttle words co-occur (D2)", () => {
    // The dangerous case: token expired, but stderr also mentions 'rate'. Auth
    // must win so the provider is disabled rather than retried.
    expect(
      looksLikeCliAuthFailure("Re-authentication required (rate of failed auth attempts high)"),
    ).toBe(true);
  });
});

describe("looksLikeCliRateLimit", () => {
  it.each([
    "ERROR: unexpected status 429 Too Many Requests",
    "rate_limit_exceeded",
    "Codex CLI rate limited",
    "You've hit your weekly limit · resets 4pm (UTC)",
    "usage limit reached; retry after 30 seconds",
  ])("classifies genuine capacity exhaustion %j", (text) => {
    expect(looksLikeCliRateLimit(text)).toBe(true);
  });

  it.each([
    "The gpt-5.3-codex model is not supported when using Codex with a ChatGPT account. Please use a supported model (for example, gpt-5.4) or use Codex with an API key. ChatGPT subscription account access can degrade performance.",
    "model produced an empty response",
    "Reading prompt from stdin...",
  ])("does not misclassify non-capacity stderr %j", (text) => {
    expect(looksLikeCliRateLimit(text)).toBe(false);
  });
});
