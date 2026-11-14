import { describe, expect, it, vi } from "vitest";
import { isConnectFailure, withConnectRetry } from "./connect-retry";

const connectTimeout = () => Object.assign(new TypeError("fetch failed"), {
  cause: Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" }),
});
const noSleep = async (_ms: number) => {};

describe("isConnectFailure", () => {
  it("recognises a failed connect anywhere in the cause chain", () => {
    expect(isConnectFailure(connectTimeout())).toBe(true);
    expect(isConnectFailure(Object.assign(new Error("x"), { code: "EAI_AGAIN" }))).toBe(true);
    expect(isConnectFailure({ cause: { errors: [{ code: "ETIMEDOUT" }, { code: "ENETUNREACH" }] } })).toBe(true);
  });

  it("does not treat a failure after the request left as a failed connect", () => {
    expect(isConnectFailure(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe(false);
    expect(isConnectFailure(Object.assign(new Error("x"), { code: "UND_ERR_SOCKET" }))).toBe(false);
    expect(isConnectFailure(new Error("GitHub API POST: 422"))).toBe(false);
    expect(isConnectFailure(null)).toBe(false);
  });
});

describe("withConnectRetry", () => {
  it("retries until the connection opens", async () => {
    const request = vi.fn().mockRejectedValueOnce(connectTimeout()).mockRejectedValueOnce(connectTimeout()).mockResolvedValue("ok");
    const sleep = vi.fn(noSleep);
    await expect(withConnectRetry(request, { sleep })).resolves.toBe("ok");
    expect(request).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(call => call[0])).toEqual([500, 1000]);
  });

  it("gives up after the attempt budget and surfaces the last error", async () => {
    const request = vi.fn().mockRejectedValue(connectTimeout());
    await expect(withConnectRetry(request, { attempts: 3, sleep: noSleep })).rejects.toThrow("fetch failed");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("never repeats a request that failed for another reason", async () => {
    const request = vi.fn().mockRejectedValue(Object.assign(new Error("reset"), { code: "ECONNRESET" }));
    await expect(withConnectRetry(request, { sleep: noSleep })).rejects.toThrow("reset");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
