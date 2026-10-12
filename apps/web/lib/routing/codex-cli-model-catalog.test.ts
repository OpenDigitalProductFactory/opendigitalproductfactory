import { EventEmitter } from "events";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const authMock = vi.hoisted(() => vi.fn().mockResolvedValue({ type: "chatgptAuthTokens", accessToken: "selected-token", chatgptAccountId: "account-b" }));
vi.mock("@/lib/shared/lazy-node", () => ({
  lazyChildProcess: () => ({ spawn: spawnMock }),
}));
vi.mock("./codex-cli-catalog-auth", () => ({ resolveCodexCatalogAuth: authMock, CODEX_CATALOG_RUNNER: "private-catalog-runner" }));

import { discoverCodexCliModels, parseCodexModelListPage } from "./codex-cli-model-catalog";

function processMock() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  spawnMock.mockReturnValue(proc);
  return proc;
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("parseCodexModelListPage", () => {
  it("preserves account metadata and excludes hidden models", () => {
    const result = parseCodexModelListPage({
      data: [
        {
          id: "gpt-6-astra",
          model: "gpt-6-astra",
          displayName: "GPT-6-Astra",
          hidden: false,
          isDefault: true,
          inputModalities: ["text", "image"],
          supportedReasoningEfforts: [{ reasoningEffort: "high", description: "Deep" }],
        },
        { id: "internal-model", model: "internal-model", hidden: true },
      ],
      nextCursor: "page-2",
    });

    expect(result.nextCursor).toBe("page-2");
    expect(result.models).toEqual([
      {
        modelId: "gpt-6-astra",
        rawMetadata: expect.objectContaining({
          source: "codex_cli_model_list",
          displayName: "GPT-6-Astra",
          isDefault: true,
          inputModalities: ["text", "image"],
        }),
      },
    ]);
  });

  it("rejects malformed authoritative output instead of treating it as an empty list", () => {
    expect(() => parseCodexModelListPage({ nextCursor: null })).toThrow(
      "Malformed Codex model/list response",
    );
  });

  it("accepts an explicitly empty authoritative page", () => {
    expect(parseCodexModelListPage({ data: [], nextCursor: null })).toEqual({
      models: [],
      nextCursor: null,
    });
  });

  it("rejects a partly malformed inventory or cursor rather than retiring omitted history", () => {
    expect(() => parseCodexModelListPage({ data: [{ model: "new-valid-model" }, {}], nextCursor: null })).toThrow("Malformed");
    expect(() => parseCodexModelListPage({ data: [{ model: "new-valid-model" }], nextCursor: 4 })).toThrow("Malformed");
  });
});

describe("discoverCodexCliModels", () => {
  it("initializes app-server and follows pagination", async () => {
    const proc = processMock();
    const result = discoverCodexCliModels();
    await Promise.resolve();
    proc.stdout.emit("data", Buffer.from('{"id":1,"result":{}}\n'));
    proc.stdout.emit("data", Buffer.from('{"id":2,"result":{"type":"chatgptAuthTokens"}}\n'));
    proc.stdout.emit("data", Buffer.from('{"id":3,"result":{"data":[{"model":"gpt-6-astra","hidden":false}],"nextCursor":"c2"}}\n'));
    proc.stdout.emit("data", Buffer.from('{"id":4,"result":{"data":[{"model":"gpt-5.6-sol","hidden":false}],"nextCursor":null}}\n'));

    await expect(result).resolves.toEqual([
      { modelId: "gpt-6-astra", rawMetadata: expect.objectContaining({ source: "codex_cli_model_list" }) },
      { modelId: "gpt-5.6-sol", rawMetadata: expect.objectContaining({ source: "codex_cli_model_list" }) },
    ]);
    expect(proc.stdin.write.mock.calls.map(([line]) => JSON.parse(line))).toEqual([
      expect.objectContaining({ method: "initialize" }),
      { method: "initialized", params: {} },
      { method: "account/login/start", id: 2, params: { type: "chatgptAuthTokens", accessToken: "selected-token", chatgptAccountId: "account-b" } },
      { method: "model/list", id: 3, params: { cursor: null, limit: 100 } },
      { method: "model/list", id: 4, params: { cursor: "c2", limit: 100 } },
    ]);
  });

  it("fails closed on timeout", async () => {
    vi.useFakeTimers();
    const proc = processMock();
    const result = discoverCodexCliModels();
    const rejection = expect(result).rejects.toThrow("timed out");
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("sends the explicit account to the resolver and keeps tokens out of process arguments", async () => {
    vi.stubEnv("OPENAI_API_KEY", "foreign-host-key");
    vi.stubEnv("CODEX_API_KEY", "foreign-host-key");
    const proc = processMock();
    const result = discoverCodexCliModels("chatgpt", "connection-b");
    await Promise.resolve();
    proc.stdout.emit("data", Buffer.from('{"id":1,"result":{}}\n{"id":2,"result":{"type":"chatgptAuthTokens"}}\n{"id":3,"result":{"data":[],"nextCursor":null}}\n'));
    await expect(result).resolves.toEqual([]);
    expect(authMock).toHaveBeenCalledWith("chatgpt", "connection-b");
    const args = spawnMock.mock.calls[0]![1];
    expect(args).toEqual(expect.arrayContaining(["OPENAI_API_KEY=", "CODEX_API_KEY=", "node", "private-catalog-runner"]));
    expect(JSON.stringify(args)).not.toContain("selected-token");
    expect(spawnMock.mock.calls[0]![2].env).not.toHaveProperty("OPENAI_API_KEY");
    expect(spawnMock.mock.calls[0]![2].env).not.toHaveProperty("CODEX_API_KEY");
  });

  it("never sends credentials after initialization fails and redacts error content", async () => {
    const proc = processMock();
    const result = discoverCodexCliModels("codex", "connection-b");
    const rejection = expect(result).rejects.toThrow("initialization failed");
    await Promise.resolve();
    proc.stdout.emit("data", Buffer.from('{"id":1,"error":{"message":"selected-token"}}\n'));
    await rejection;
    expect(proc.stdin.write).toHaveBeenCalledTimes(1);
  });

  it("requires successful selected-account login before reading a catalog", async () => {
    const proc = processMock();
    const result = discoverCodexCliModels();
    const rejection = expect(result).rejects.toThrow("login failed");
    await Promise.resolve();
    proc.stdout.emit("data", Buffer.from('{"id":1,"result":{}}\n{"id":2,"error":{"message":"selected-token"}}\n'));
    await rejection;
    expect(proc.stdin.write.mock.calls.some(([line]) => JSON.parse(line).method === "model/list")).toBe(false);
  });

  it("refuses repeated cursors rather than completing partial model-access proof", async () => {
    const proc = processMock();
    const result = discoverCodexCliModels();
    const rejection = expect(result).rejects.toThrow("repeated a cursor");
    await Promise.resolve();
    proc.stdout.emit("data", Buffer.from('{"id":1,"result":{}}\n{"id":2,"result":{"type":"chatgptAuthTokens"}}\n{"id":3,"result":{"data":[],"nextCursor":"c2"}}\n{"id":4,"result":{"data":[],"nextCursor":"c2"}}\n'));
    await rejection;
  });

  it("refuses a refresh request without switching to another account", async () => {
    const proc = processMock();
    const result = discoverCodexCliModels();
    const rejection = expect(result).rejects.toThrow("needs authentication");
    await Promise.resolve();
    proc.stdout.emit("data", Buffer.from('{"id":8,"method":"account/chatgptAuthTokens/refresh","params":{"previousAccountId":"other-account"}}\n'));
    await rejection;
    expect(authMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(proc.stdin.write.mock.calls.at(-1)![0])).toMatchObject({ id: 8, error: { code: -32000 } });
  });
});
