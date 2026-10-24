import { once } from "node:events";
import { createServer } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createOffThreadpoolFetchTransport,
  createOffThreadpoolLookup,
  type CaresResolver,
} from "./off-threadpool-fetch";

const openTransports: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(openTransports.splice(0).map((transport) => transport.close()));
  vi.useRealTimers();
});

function resolver(overrides: Partial<CaresResolver> = {}): CaresResolver {
  return {
    resolve4: vi.fn(async () => ["192.0.2.10"]),
    resolve6: vi.fn(async () => ["2001:db8::10"]),
    ...overrides,
  };
}

function lookup(
  hostname: string,
  options: { family?: number | "IPv4" | "IPv6"; all?: boolean } = {},
  inputResolver: CaresResolver = resolver(),
  timeoutMs = 1_000,
): Promise<{ address: string; family: number } | Array<{ address: string; family: number }>> {
  return new Promise((resolve, reject) => {
    createOffThreadpoolLookup({ resolver: inputResolver, timeoutMs })(
      hostname,
      options,
      (error, address, family) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(Array.isArray(address) ? address : { address, family: family ?? 0 });
      },
    );
  });
}

describe("createOffThreadpoolLookup", () => {
  it("returns IP literals without calling either DNS resolver", async () => {
    const inputResolver = resolver();

    await expect(lookup("127.0.0.1", {}, inputResolver)).resolves.toEqual({
      address: "127.0.0.1",
      family: 4,
    });
    expect(inputResolver.resolve4).not.toHaveBeenCalled();
    expect(inputResolver.resolve6).not.toHaveBeenCalled();
  });

  it("uses c-ares A then AAAA without a getaddrinfo fallback", async () => {
    const inputResolver = resolver({
      resolve4: vi.fn(async () => {
        throw Object.assign(new Error("no A record"), { code: "ENODATA" });
      }),
      resolve6: vi.fn(async () => ["2001:db8::20"]),
    });

    await expect(lookup("service.internal", {}, inputResolver)).resolves.toEqual({
      address: "2001:db8::20",
      family: 6,
    });
    expect(inputResolver.resolve4).toHaveBeenCalledWith("service.internal");
    expect(inputResolver.resolve6).toHaveBeenCalledWith("service.internal");
  });

  it("honors an explicit family and all-address lookup", async () => {
    const inputResolver = resolver();

    await expect(lookup("service.internal", { family: 6 }, inputResolver)).resolves.toEqual({
      address: "2001:db8::10",
      family: 6,
    });
    expect(inputResolver.resolve4).not.toHaveBeenCalled();

    await expect(lookup("service.internal", { all: true }, inputResolver)).resolves.toEqual([
      { address: "192.0.2.10", family: 4 },
      { address: "2001:db8::10", family: 6 },
    ]);
  });

  it("fails once when resolution exceeds its deadline", async () => {
    vi.useFakeTimers();
    const inputResolver = resolver({
      resolve4: vi.fn(() => new Promise<string[]>(() => {})),
      resolve6: vi.fn(() => new Promise<string[]>(() => {})),
    });
    const callback = vi.fn();

    createOffThreadpoolLookup({ resolver: inputResolver, timeoutMs: 50 })(
      "stalled.internal",
      {},
      callback,
    );
    await vi.advanceTimersByTimeAsync(51);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0]).toMatchObject({ code: "ETIMEOUT" });
  });

  it("fails closed when neither A nor AAAA has an answer", async () => {
    const noData = () => Promise.reject(Object.assign(new Error("no record"), { code: "ENODATA" }));

    await expect(lookup("missing.internal", {}, resolver({
      resolve4: vi.fn(noData),
      resolve6: vi.fn(noData),
    }))).rejects.toMatchObject({ code: "ENOTFOUND" });
  });
});

describe("createOffThreadpoolFetchTransport", () => {
  it("connects through the injected c-ares answer instead of OS hostname lookup", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("resolved off threadpool");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected TCP listener");

    const inputResolver = resolver({ resolve4: vi.fn(async () => ["127.0.0.1"]) });
    const transport = createOffThreadpoolFetchTransport({ resolver: inputResolver });
    openTransports.push(transport);
    try {
      const response = await transport.fetch(`http://only-via-cares.invalid:${address.port}/`);
      await expect(response.text()).resolves.toBe("resolved off threadpool");
      expect(inputResolver.resolve4).toHaveBeenCalledWith("only-via-cares.invalid");
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});
