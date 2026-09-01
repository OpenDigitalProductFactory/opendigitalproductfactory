import { describe, expect, it, vi } from "vitest";

import { resolveProviderAncestry } from "./provider-ancestry";

const FEATURE = "a".repeat(40);
const SERVED = "b".repeat(40);

function response(status: string, ok = true): Response {
  return new Response(JSON.stringify({ status }), {
    status: ok ? 200 : 503,
    headers: { "content-type": "application/json" },
  });
}

function deps(fetchImpl: typeof fetch) {
  return {
    fetchImpl,
    resolveRepository: async () => ({ owner: "OpenDigitalProductFactory", name: "opendigitalproductfactory" }),
    resolveToken: async () => "token",
    timeoutSignal: () => new AbortController().signal,
  };
}

describe("resolveProviderAncestry", () => {
  it.each(["ahead", "identical"])("maps GitHub compare status %s to contained", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(status));

    await expect(resolveProviderAncestry(FEATURE, SERVED, deps(fetchImpl))).resolves.toBe(true);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(`compare/${FEATURE}...${SERVED}`);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store" });
  });

  it.each(["behind", "diverged"])("maps GitHub compare status %s to not contained", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(status));
    await expect(resolveProviderAncestry(FEATURE, SERVED, deps(fetchImpl))).resolves.toBe(false);
  });

  it.each([
    ["invalid feature identity", "short", SERVED],
    ["invalid served identity", FEATURE, "not-a-sha"],
  ])("returns unknown for %s without fetching", async (_label, feature, served) => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(resolveProviderAncestry(feature, served, deps(fetchImpl))).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["unexpected status", response("unknown")],
    ["provider HTTP failure", response("ahead", false)],
    ["unreadable payload", new Response("not-json", { status: 200 })],
  ])("returns unknown for %s", async (_label, providerResponse) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(providerResponse);
    await expect(resolveProviderAncestry(FEATURE, SERVED, deps(fetchImpl))).resolves.toBeNull();
  });

  it("returns unknown when canonical repository resolution fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(resolveProviderAncestry(FEATURE, SERVED, {
      ...deps(fetchImpl),
      resolveRepository: async () => { throw new Error("db unavailable"); },
    })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
