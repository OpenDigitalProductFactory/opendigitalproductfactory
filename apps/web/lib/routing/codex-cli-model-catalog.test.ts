import { EventEmitter } from "events";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const authMock = vi.hoisted(() => vi.fn().mockResolvedValue({ mode: "oauth" }));
vi.mock("@/lib/shared/lazy-node", () => ({
  lazyChildProcess: () => ({ spawn: spawnMock }),
}));
vi.mock("./codex-cli-adapter", () => ({ prepareCodexCliAuth: authMock }));

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
});

describe("discoverCodexCliModels", () => {
  it("initializes app-server and follows pagination", async () => {
    const proc = processMock();
    const result = discoverCodexCliModels();
    await Promise.resolve();
    proc.stdout.emit("data", Buffer.from('{"id":1,"result":{}}\n'));
    proc.stdout.emit("data", Buffer.from('{"id":2,"result":{"data":[{"model":"gpt-6-astra","hidden":false}],"nextCursor":"c2"}}\n'));
    proc.stdout.emit("data", Buffer.from('{"id":3,"result":{"data":[{"model":"gpt-5.6-sol","hidden":false}],"nextCursor":null}}\n'));

    await expect(result).resolves.toEqual([
      { modelId: "gpt-6-astra", rawMetadata: expect.objectContaining({ source: "codex_cli_model_list" }) },
      { modelId: "gpt-5.6-sol", rawMetadata: expect.objectContaining({ source: "codex_cli_model_list" }) },
    ]);
    expect(proc.stdin.write.mock.calls.map(([line]) => JSON.parse(line))).toEqual([
      expect.objectContaining({ method: "initialize" }),
      { method: "initialized", params: {} },
      { method: "model/list", id: 2, params: { cursor: null, limit: 100 } },
      { method: "model/list", id: 3, params: { cursor: "c2", limit: 100 } },
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
});
