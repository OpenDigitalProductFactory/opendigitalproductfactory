import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("@/lib/shared/lazy-node", () => ({ lazyChildProcess: () => ({ spawn: m.spawn }) }));
import { readCodexCliCapacity } from "./codex-cli-capacity";
const login = { type: "chatgptAuthTokens" as const, accessToken: "synthetic-token", chatgptAccountId: "selected" };
function child(accountId = "selected") {
  const stdout = new EventEmitter();
  const proc = Object.assign(new EventEmitter(), { stdout, stderr: new EventEmitter(),
    stdin: Object.assign(new EventEmitter(), { end: vi.fn(), write: vi.fn((line: string) => {
      const message = JSON.parse(line);
      if (message.id === undefined) return;
      const result = message.method === "account/login/start" ? { type: login.type }
        : message.method === "account/rateLimits/read" ? { accountId, rateLimits: { primary: { usedPercent: 0 }, secondary: { usedPercent: 10 } } } : {};
      queueMicrotask(() => stdout.emit("data", Buffer.from(JSON.stringify({ id: message.id, result }) + "\n")));
    }) }), kill: vi.fn() });
  m.spawn.mockReturnValue(proc); return proc;
}
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
describe("selected-account Codex capacity transport", () => {
  it("reads current usage with explicit null params and always cleans up", async () => {
    const proc = child();
    expect(await readCodexCliCapacity(login)).toBe(true);
    const writes = proc.stdin.write.mock.calls.map(([line]) => JSON.parse(line));
    expect(writes).toContainEqual(expect.objectContaining({ method: "account/login/start", params: login }));
    expect(writes).toContainEqual(expect.objectContaining({ method: "account/rateLimits/read", params: null }));
    expect(JSON.stringify(m.spawn.mock.calls[0]?.slice(0, 2))).not.toContain(login.accessToken);
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });
  it("does not trust another account's usage", async () => {
    child("other"); expect(await readCodexCliCapacity(login)).toBe(false);
  });
  it("bounds an unresponsive app server and returns unknown capacity", async () => {
    vi.useFakeTimers(); const proc = child(); proc.stdin.write.mockImplementation(() => {});
    const result = readCodexCliCapacity(login);
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await result).toBe(false); expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
