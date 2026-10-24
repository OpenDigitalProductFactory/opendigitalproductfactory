import { EventEmitter } from "events";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const login = { type: "chatgptAuthTokens" as const, accessToken: "selected-token", chatgptAccountId: "account-b" };
vi.mock("@/lib/shared/lazy-node", () => ({
  lazyChildProcess: () => ({ spawn: spawnMock }),
}));

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

function proof(proc: ReturnType<typeof processMock>, responseId: number) {
  proc.stdout.emit("data", Buffer.from(JSON.stringify({ method: "dpf/catalog-provenance", params: { responseId, verified: true, clientVersion: "0.157.0", fetchedAt: "2026-10-13T04:35:00Z" } }) + "\n"));
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
  it("rejects a successful RPC catalog without remote provenance", async () => {
    const proc = processMock();
    const result = discoverCodexCliModels(login);
    const rejection = expect(result).rejects.toThrow("could not be verified");
    proc.stdout.emit("data", Buffer.from('{"id":1,"result":{}}\n{"id":2,"result":{"type":"chatgptAuthTokens"}}\n{"id":3,"result":{"data":[{"model":"bundled-model"}],"nextCursor":null}}\n'));
    await rejection;
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("does not admit bundled fallback when the private runner reports absent remote evidence", async () => {
    const proc = processMock();
    const result = discoverCodexCliModels(login);
    const rejection = expect(result).rejects.toThrow("could not be verified");
    proc.stdout.emit("data", Buffer.from('{"id":1,"result":{}}\n{"id":2,"result":{"type":"chatgptAuthTokens"}}\n{"method":"dpf/catalog-provenance","params":{"responseId":3,"verified":false,"error":"selected-token"}}\n{"id":3,"result":{"data":[{"model":"bundled-model"}],"nextCursor":null}}\n'));
    await rejection;
  });

  it("rejects provenance for another response instead of accepting the current page", async () => {
    const proc = processMock();
    const result = discoverCodexCliModels(login);
    const rejection = expect(result).rejects.toThrow("could not be verified");
    proc.stdout.emit("data", Buffer.from('{"id":1,"result":{}}\n{"id":2,"result":{"type":"chatgptAuthTokens"}}\n{"method":"dpf/catalog-provenance","params":{"responseId":4,"verified":true,"clientVersion":"0.157.0","fetchedAt":"2026-10-13T04:35:00Z"}}\n{"id":3,"result":{"data":[{"model":"fresh-model"}],"nextCursor":null}}\n'));
    await rejection;
  });

  it("rejects a complete empty catalog even when remote provenance is present", async () => {
    const proc = processMock();
    const result = discoverCodexCliModels(login);
    const rejection = expect(result).rejects.toThrow("no visible models");
    proc.stdout.emit("data", Buffer.from('{"id":1,"result":{}}\n{"id":2,"result":{"type":"chatgptAuthTokens"}}\n{"method":"dpf/catalog-provenance","params":{"responseId":3,"verified":true,"clientVersion":"0.157.0","fetchedAt":"2026-10-13T04:35:00Z"}}\n{"id":3,"result":{"data":[],"nextCursor":null}}\n'));
    await rejection;
  });

  it("initializes app-server and follows pagination", async () => {
    const proc = processMock();
    const result = discoverCodexCliModels(login);
    await Promise.resolve();
    proc.stdout.emit("data", Buffer.from('{"id":1,"result":{}}\n'));
    proc.stdout.emit("data", Buffer.from('{"id":2,"result":{"type":"chatgptAuthTokens"}}\n'));
    proof(proc, 3);
    proc.stdout.emit("data", Buffer.from('{"id":3,"result":{"data":[{"model":"gpt-6-astra","hidden":false}],"nextCursor":"c2"}}\n'));
    proof(proc, 4);
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

  it("preserves fragmented Unicode metadata without adding proof timestamps to model hashes", async () => {
    const proc = processMock();
    const result = discoverCodexCliModels(login);
    proc.stdout.emit("data", Buffer.from('{"id":1,"result":{}}\n{"id":2,"result":{"type":"chatgptAuthTokens"}}\n'));
    proof(proc, 3);
    const wire = Buffer.from(JSON.stringify({ id: 3, result: { data: [{ model: "future-model", description: "モデル 🦊" }], nextCursor: null } }) + "\n");
    for (const byte of wire) proc.stdout.emit("data", Buffer.from([byte]));
    const models = await result;
    expect(models[0]!.rawMetadata.description).toBe("モデル 🦊");
    expect(models[0]!.rawMetadata).not.toHaveProperty("fetchedAt");
    expect(models[0]!.rawMetadata).not.toHaveProperty("clientVersion");
  });

  it("refuses proof replay across pages", async () => {
    const proc = processMock();
    const result = discoverCodexCliModels(login);
    const rejection = expect(result).rejects.toThrow("could not be verified");
    proc.stdout.emit("data", Buffer.from('{"id":1,"result":{}}\n{"id":2,"result":{"type":"chatgptAuthTokens"}}\n'));
    proof(proc, 3);
    proc.stdout.emit("data", Buffer.from('{"id":3,"result":{"data":[{"model":"fresh-model"}],"nextCursor":"p2"}}\n'));
    proc.stdout.emit("data", Buffer.from('{"id":4,"result":{"data":[{"model":"unverified-model"}],"nextCursor":null}}\n'));
    await rejection;
  });

  it("preserves empty-catalog semantics for hidden-only remote inventory", async () => {
    const proc = processMock();
    const result = discoverCodexCliModels(login);
    const rejection = expect(result).rejects.toThrow("no visible models");
    proc.stdout.emit("data", Buffer.from('{"id":1,"result":{}}\n{"id":2,"result":{"type":"chatgptAuthTokens"}}\n'));
    proof(proc, 3);
    proc.stdout.emit("data", Buffer.from('{"id":3,"result":{"data":[{"model":"hidden-model","hidden":true}],"nextCursor":null}}\n'));
    await rejection;
  });

  it("fails closed on timeout", async () => {
    vi.useFakeTimers();
    const proc = processMock();
    const result = discoverCodexCliModels(login);
    const rejection = expect(result).rejects.toThrow("timed out");
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("keeps prepared selected-account tokens out of process arguments and environment", async () => {
    vi.stubEnv("OPENAI_API_KEY", "foreign-host-key");
    vi.stubEnv("CODEX_API_KEY", "foreign-host-key");
    const proc = processMock();
    const result = discoverCodexCliModels(login);
    await Promise.resolve();
    proc.stdout.emit("data", Buffer.from('{"id":1,"result":{}}\n{"id":2,"result":{"type":"chatgptAuthTokens"}}\n'));
    proof(proc, 3);
    proc.stdout.emit("data", Buffer.from('{"id":3,"result":{"data":[{"model":"fresh-model"}],"nextCursor":null}}\n'));
    await expect(result).resolves.toHaveLength(1);
    const args = spawnMock.mock.calls[0]![1];
    expect(args).toEqual(expect.arrayContaining(["OPENAI_API_KEY=", "CODEX_API_KEY=", "node"]));
    expect(args.at(-1)).toContain("mkdtempSync('/tmp/dpf-codex-catalog-')");
    expect(JSON.stringify(args)).not.toContain("selected-token");
    expect(spawnMock.mock.calls[0]![2].env).not.toHaveProperty("OPENAI_API_KEY");
    expect(spawnMock.mock.calls[0]![2].env).not.toHaveProperty("CODEX_API_KEY");
  });

  it("never sends credentials after initialization fails and redacts error content", async () => {
    const proc = processMock();
    const result = discoverCodexCliModels(login);
    const rejection = expect(result).rejects.toThrow("initialization failed");
    await Promise.resolve();
    proc.stdout.emit("data", Buffer.from('{"id":1,"error":{"message":"selected-token"}}\n'));
    await rejection;
    expect(proc.stdin.write).toHaveBeenCalledTimes(1);
  });

  it("requires successful selected-account login before reading a catalog", async () => {
    const proc = processMock();
    const result = discoverCodexCliModels(login);
    const rejection = expect(result).rejects.toThrow("login failed");
    await Promise.resolve();
    proc.stdout.emit("data", Buffer.from('{"id":1,"result":{}}\n{"id":2,"error":{"message":"selected-token"}}\n'));
    await rejection;
    expect(proc.stdin.write.mock.calls.some(([line]) => JSON.parse(line).method === "model/list")).toBe(false);
  });

  it("refuses catalog output received before selected-account login", async () => {
    const proc = processMock();
    const result = discoverCodexCliModels(login);
    const rejection = expect(result).rejects.toThrow("Unexpected Codex catalog response");
    await Promise.resolve();
    proc.stdout.emit("data", Buffer.from('{"id":3,"result":{"data":[],"nextCursor":null}}\n'));
    await rejection;
  });

  it("refuses repeated cursors rather than completing partial model-access proof", async () => {
    const proc = processMock();
    const result = discoverCodexCliModels(login);
    const rejection = expect(result).rejects.toThrow("repeated a cursor");
    await Promise.resolve();
    proc.stdout.emit("data", Buffer.from('{"id":1,"result":{}}\n{"id":2,"result":{"type":"chatgptAuthTokens"}}\n'));
    proof(proc, 3);
    proc.stdout.emit("data", Buffer.from('{"id":3,"result":{"data":[],"nextCursor":"c2"}}\n'));
    proof(proc, 4);
    proc.stdout.emit("data", Buffer.from('{"id":4,"result":{"data":[],"nextCursor":"c2"}}\n'));
    await rejection;
  });

  it("refuses a refresh request without switching to another account", async () => {
    const proc = processMock();
    const result = discoverCodexCliModels(login);
    const rejection = expect(result).rejects.toThrow("needs authentication");
    await Promise.resolve();
    proc.stdout.emit("data", Buffer.from('{"id":8,"method":"account/chatgptAuthTokens/refresh","params":{"previousAccountId":"other-account"}}\n'));
    await rejection;
    expect(JSON.parse(proc.stdin.write.mock.calls.at(-1)![0])).toMatchObject({ id: 8, error: { code: -32000 } });
  });
});

