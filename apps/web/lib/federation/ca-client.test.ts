import { describe, expect, it, vi } from "vitest";

import { caInternalUrl, resolveCaHost } from "./ca-client";

describe("resolveCaHost", () => {
  it("returns an IP literal untouched, without touching any resolver", async () => {
    const resolver = { resolve4: vi.fn(), resolve6: vi.fn(), lookup: vi.fn() };
    expect(await resolveCaHost("172.18.0.7", resolver as never)).toEqual({ address: "172.18.0.7", family: 4 });
    expect(await resolveCaHost("::1", resolver as never)).toEqual({ address: "::1", family: 6 });
    expect(resolver.resolve4).not.toHaveBeenCalled();
    expect(resolver.lookup).not.toHaveBeenCalled();
  });

  it("resolves a compose service name through c-ares (A, then AAAA) and never reaches getaddrinfo", async () => {
    const resolver = { resolve4: vi.fn(async () => ["172.18.0.7"]), resolve6: vi.fn(), lookup: vi.fn() };
    expect(await resolveCaHost("step-ca", resolver as never)).toEqual({ address: "172.18.0.7", family: 4 });
    expect(resolver.resolve6).not.toHaveBeenCalled();
    expect(resolver.lookup).not.toHaveBeenCalled();

    const v6only = { resolve4: vi.fn(async () => { throw Object.assign(new Error("ENODATA"), { code: "ENODATA" }); }), resolve6: vi.fn(async () => ["fd00::7"]), lookup: vi.fn() };
    expect(await resolveCaHost("step-ca", v6only as never)).toEqual({ address: "fd00::7", family: 6 });
    expect(v6only.lookup).not.toHaveBeenCalled();
  });

  it("fails closed without falling back to getaddrinfo when c-ares has no record", async () => {
    const resolver = {
      resolve4: vi.fn(async () => { throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }); }),
      resolve6: vi.fn(async () => { throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }); }),
      lookup: vi.fn(async () => ({ address: "127.0.0.1", family: 4 })),
    };
    await expect(resolveCaHost("host.docker.internal", resolver)).rejects.toMatchObject({ code: "ENOTFOUND" });
    expect(resolver.lookup).not.toHaveBeenCalled();
  });
});

describe("caInternalUrl", () => {
  it("defaults to the compose service and trims a configured trailing slash", () => {
    expect(caInternalUrl({})).toBe("https://step-ca:9000");
    expect(caInternalUrl({ DPF_ORGANIZATION_CA_INTERNAL_URL: "https://ca.internal:9443/" })).toBe("https://ca.internal:9443");
  });
});
