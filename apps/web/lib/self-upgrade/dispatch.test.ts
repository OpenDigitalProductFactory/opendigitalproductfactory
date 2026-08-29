import { describe, expect, it, vi } from "vitest";
import {
  DispatchFailure,
  describeDispatchFailure,
  isRetryableDispatchError,
  sendWithTransientRetry,
} from "@/lib/self-upgrade/dispatch";

/** The exact shape undici throws — a bare TypeError with the real code nested in `cause`. */
function connectTimeout(): Error {
  const err = new TypeError("fetch failed");
  (err as { cause?: unknown }).cause = Object.assign(
    new Error("Connect Timeout Error (attempted address: inngest:8288, timeout: 10000ms)"),
    { code: "UND_ERR_CONNECT_TIMEOUT" },
  );
  return err;
}

describe("isRetryableDispatchError", () => {
  it("retries the nested connect timeout that failed SUR-D71E8971", () => {
    expect(isRetryableDispatchError(connectTimeout())).toBe(true);
  });

  it.each(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"])(
    "retries transport code %s",
    (code) => {
      expect(isRetryableDispatchError(Object.assign(new Error("boom"), { code }))).toBe(true);
    },
  );

  it("retries a bare fetch failure whose cause was stripped", () => {
    expect(isRetryableDispatchError(new TypeError("fetch failed"))).toBe(true);
  });

  it("does not retry an HTTP rejection from the event API", () => {
    // A bad event key or malformed payload is a real misconfiguration. Retrying
    // would delay the only signal the operator can act on.
    const rejected = Object.assign(new Error("Unauthorized"), { status: 401 });
    expect(isRetryableDispatchError(rejected)).toBe(false);
  });

  it("does not retry an ordinary application error", () => {
    expect(isRetryableDispatchError(new Error("inngest offline"))).toBe(false);
  });
});

describe("sendWithTransientRetry", () => {
  it("carries a send that fails once and then succeeds", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(connectTimeout())
      .mockResolvedValueOnce({ ids: ["evt-1"] });

    const result = await sendWithTransientRetry(send, { sleep: async () => {} });

    expect(result).toEqual({ ids: ["evt-1"] });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("gives up after three transport failures and reports the true count", async () => {
    const send = vi.fn().mockRejectedValue(connectTimeout());

    await expect(sendWithTransientRetry(send, { sleep: async () => {} })).rejects.toMatchObject({
      name: "DispatchFailure",
      attempts: 3,
    });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-transport failure", async () => {
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("Bad Request"), { status: 400 }));

    await expect(sendWithTransientRetry(send, { sleep: async () => {} })).rejects.toMatchObject({
      attempts: 1,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("backs off between attempts rather than spinning", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const send = vi
      .fn()
      .mockRejectedValueOnce(connectTimeout())
      .mockResolvedValueOnce({ ids: [] });

    await sendWithTransientRetry(send, { sleep });

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0]?.[0]).toBeGreaterThan(0);
  });
});

describe("describeDispatchFailure", () => {
  it("names the endpoint and the error class instead of just 'fetch failed'", () => {
    const failure = new DispatchFailure(connectTimeout(), 3);

    const message = describeDispatchFailure(failure, "http://inngest:8288");

    expect(message).toContain("http://inngest:8288");
    expect(message).toContain("UND_ERR_CONNECT_TIMEOUT");
    expect(message).toContain("after 3 attempts");
  });

  it("does not claim retries that never happened", () => {
    // The regression this guards: reporting a fixed max-attempts constant made a
    // single non-retryable failure read as three exhausted tries.
    const failure = new DispatchFailure(new Error("inngest offline"), 1);

    expect(describeDispatchFailure(failure, "http://inngest:8288")).toContain("after 1 attempt");
  });

  it("handles a raw error that never went through the retry helper", () => {
    expect(describeDispatchFailure(new Error("boom"), "endpoint")).toContain("after 1 attempt");
  });
});
