import { describe, expect, it, vi } from "vitest";

import { SafeRequestError, safeJsonRequest } from "./safe-request";

const publicDns = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  const bytes = new TextEncoder().encode(typeof body === "string" ? body : JSON.stringify(body));
  return {
    status,
    headers: new Headers(headers),
    body: (async function* () { yield bytes; })(),
  };
}

describe("safeJsonRequest", () => {
  it("resolves and pins a public address before sending credentials", async () => {
    const transport = vi.fn(async (input: { url: URL; addresses: readonly string[]; headers: Record<string, string> }) =>
      response(200, { ok: true }),
    );
    await expect(safeJsonRequest({
      url: "https://wordpress.example/wp-json/",
      headers: { authorization: "Basic secret" },
      resolve: publicDns,
      transport,
    })).resolves.toMatchObject({ status: 200, data: { ok: true } });
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({ addresses: ["93.184.216.34"] }));
  });

  it.each(["127.0.0.1", "10.0.0.8", "169.254.169.254", "::1", "fd00::1"])(
    "blocks a hostname resolving to private address %s",
    async (address) => {
      const transport = vi.fn();
      await expect(safeJsonRequest({
        url: "https://wordpress.example/wp-json/",
        resolve: async () => [{ address, family: address.includes(":") ? 6 : 4 }],
        transport,
      })).rejects.toMatchObject({ code: "private_network" });
      expect(transport).not.toHaveBeenCalled();
    },
  );

  it("re-resolves redirects, permits only the original origin, and never follows a private target", async () => {
    const resolve = vi.fn(async (host: string) => host === "wordpress.example"
      ? [{ address: "93.184.216.34", family: 4 as const }]
      : [{ address: "10.0.0.9", family: 4 as const }]);
    const transport = vi.fn(async () => response(302, "", { location: "https://internal.example/admin" }));
    await expect(safeJsonRequest({
      url: "https://wordpress.example/wp-json/",
      headers: { authorization: "Basic secret" },
      resolve,
      transport,
    })).rejects.toMatchObject({ code: "cross_origin_redirect" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("blocks DNS rebinding when the same origin changes to a private address on redirect", async () => {
    let resolution = 0;
    const resolve = vi.fn(async () => [{ address: resolution++ === 0 ? "93.184.216.34" : "10.0.0.9", family: 4 as const }]);
    const transport = vi.fn()
      .mockResolvedValueOnce(response(302, "", { location: "/wp-json/wp/v2/types" }));
    await expect(safeJsonRequest({ url: "https://wordpress.example/wp-json/", resolve, transport }))
      .rejects.toMatchObject({ code: "private_network" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("quarantines a write redirect instead of replaying the mutation", async () => {
    const transport = vi.fn(async () =>
      response(307, "", { location: "/wp-json/wp/v2/posts/42" }),
    );

    await expect(safeJsonRequest({
      url: "https://wordpress.example/wp-json/wp/v2/posts",
      method: "POST",
      body: JSON.stringify({ title: "Approved update" }),
      resolve: publicDns,
      transport,
    })).rejects.toMatchObject({
      code: "write_redirect",
      retryable: false,
      ambiguous: true,
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized and malformed JSON responses without echoing credentials", async () => {
    const secret = "application-password-secret";
    const transport = vi.fn(async () => response(200, "x".repeat(65), { "content-type": "application/json" }));
    await expect(safeJsonRequest({
      url: "https://wordpress.example/wp-json/",
      headers: { authorization: `Basic ${secret}` },
      maxResponseBytes: 64,
      resolve: publicDns,
      transport,
    })).rejects.toSatisfy((error: unknown) =>
      error instanceof SafeRequestError && error.code === "response_too_large" && !error.message.includes(secret),
    );
  });
});
