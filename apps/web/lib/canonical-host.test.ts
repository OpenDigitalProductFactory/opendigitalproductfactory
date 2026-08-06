import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { decideHostMatch, enforceCanonicalHost, isCanonicalRedirectExempt } from "./canonical-host";

const path = "/foo";
const search = "?bar=1";

describe("decideHostMatch", () => {
  it("passthrough when canonicalUrl is undefined (bootstrap-before-DNS)", () => {
    const result = decideHostMatch({
      host: "localhost:3000",
      path,
      search,
      config: { canonicalUrl: undefined, aliases: "" },
    });
    expect(result).toEqual({ kind: "passthrough", reason: "no-canonical-configured" });
  });

  it("passthrough when canonicalUrl is empty string", () => {
    const result = decideHostMatch({
      host: "localhost:3000",
      path,
      search,
      config: { canonicalUrl: "", aliases: "" },
    });
    expect(result).toEqual({ kind: "passthrough", reason: "no-canonical-configured" });
  });

  it("passthrough when host header is missing", () => {
    const result = decideHostMatch({
      host: null,
      path,
      search,
      config: { canonicalUrl: "https://portal.example.com", aliases: "" },
    });
    expect(result).toEqual({ kind: "passthrough", reason: "no-host-header" });
  });

  it("passthrough when host matches canonical exactly", () => {
    const result = decideHostMatch({
      host: "portal.example.com",
      path,
      search,
      config: { canonicalUrl: "https://portal.example.com", aliases: "" },
    });
    expect(result).toEqual({ kind: "passthrough", reason: "host-matches-canonical" });
  });

  it("passthrough is case-insensitive on host comparison", () => {
    const result = decideHostMatch({
      host: "PORTAL.EXAMPLE.COM",
      path,
      search,
      config: { canonicalUrl: "https://portal.example.com", aliases: "" },
    });
    expect(result).toEqual({ kind: "passthrough", reason: "host-matches-canonical" });
  });

  it("passthrough when host:port matches canonical:port", () => {
    const result = decideHostMatch({
      host: "portal.example.com:3000",
      path,
      search,
      config: { canonicalUrl: "https://portal.example.com:3000", aliases: "" },
    });
    expect(result).toEqual({ kind: "passthrough", reason: "host-matches-canonical" });
  });

  it("redirect when port mismatches (different origin per browser)", () => {
    const result = decideHostMatch({
      host: "portal.example.com",
      path,
      search,
      config: { canonicalUrl: "https://portal.example.com:3000", aliases: "" },
    });
    expect(result).toEqual({
      kind: "redirect",
      targetUrl: "https://portal.example.com:3000/foo?bar=1",
    });
  });

  it("passthrough when host matches alias entry", () => {
    const result = decideHostMatch({
      host: "192.168.1.10:3000",
      path,
      search,
      config: {
        canonicalUrl: "https://portal.example.com",
        aliases: "192.168.1.10:3000",
      },
    });
    expect(result).toEqual({ kind: "passthrough", reason: "host-matches-alias" });
  });

  it("alias entries are trimmed and case-insensitive", () => {
    const result = decideHostMatch({
      host: "192.168.1.10:3000",
      path,
      search,
      config: {
        canonicalUrl: "https://portal.example.com",
        aliases: " 192.168.1.10:3000 , portal.local ",
      },
    });
    expect(result).toEqual({ kind: "passthrough", reason: "host-matches-alias" });
  });

  it("redirect preserves path and query string", () => {
    const result = decideHostMatch({
      host: "localhost:3000",
      path: "/foo",
      search: "?bar=1&baz=2",
      config: { canonicalUrl: "https://portal.example.com", aliases: "" },
    });
    expect(result).toEqual({
      kind: "redirect",
      targetUrl: "https://portal.example.com/foo?bar=1&baz=2",
    });
  });

  it("redirect to root path when path is /", () => {
    const result = decideHostMatch({
      host: "localhost:3000",
      path: "/",
      search: "",
      config: { canonicalUrl: "https://portal.example.com", aliases: "" },
    });
    expect(result).toEqual({
      kind: "redirect",
      targetUrl: "https://portal.example.com/",
    });
  });

  it("passthrough on malformed canonicalUrl (graceful — do not crash app on env typo)", () => {
    const result = decideHostMatch({
      host: "localhost:3000",
      path,
      search,
      config: { canonicalUrl: ":://broken", aliases: "" },
    });
    expect(result).toEqual({ kind: "passthrough", reason: "no-canonical-configured" });
  });

  it("passthrough for IPv6 literal hosts matching canonical", () => {
    const result = decideHostMatch({
      host: "[::1]:3000",
      path,
      search,
      config: { canonicalUrl: "http://[::1]:3000", aliases: "" },
    });
    expect(result).toEqual({ kind: "passthrough", reason: "host-matches-canonical" });
  });

  it("normalizes trailing slash in canonicalUrl when building redirect target", () => {
    const result = decideHostMatch({
      host: "localhost:3000",
      path: "/foo",
      search: "",
      config: { canonicalUrl: "https://portal.example.com/", aliases: "" },
    });
    expect(result).toEqual({
      kind: "redirect",
      targetUrl: "https://portal.example.com/foo",
    });
  });
});

describe("isCanonicalRedirectExempt", () => {
  it.each(["/api/health", "/api/healthz", "/api/ready"])(
    "exempts health-probe path %s",
    (p) => expect(isCanonicalRedirectExempt(p)).toBe(true),
  );

  it.each([
    "/api/inngest",
    "/api/inngest/",
    "/api/mcp",
    "/api/mcp/v1",
    "/api/mcp/v1/anything",
  ])("exempts internal service callback %s", (p) =>
    expect(isCanonicalRedirectExempt(p)).toBe(true),
  );

  it.each([
    "/api/v1/federation",
    "/api/v1/federation/enroll",
    "/api/v1/federation/approval-relay",
    "/api/v1/federation/demand",
    "/api/v1/federation/demand/reconcile",
    "/api/v1/federation/incident",
    "/api/v1/federation/proposal",
  ])("exempts remote federation peer callback %s", (p) =>
    expect(isCanonicalRedirectExempt(p)).toBe(true),
  );

  it.each([
    "/",
    "/ops/demand",
    "/api/inngestx",
    "/api/mcpx",
    "/api/health/extra",
    "/api/v1/federationx",
    "/api/v1/federation-summary",
    "/platform/federation-links",
  ])("does NOT exempt browser/other route %s", (p) =>
    expect(isCanonicalRedirectExempt(p)).toBe(false),
  );
});

// Helper: build a NextRequest with optional host / x-forwarded-host headers.
function buildRequest(opts: {
  url: string;
  host?: string;
  xForwardedHost?: string;
}): NextRequest {
  const headers = new Headers();
  if (opts.host !== undefined) headers.set("host", opts.host);
  if (opts.xForwardedHost !== undefined) headers.set("x-forwarded-host", opts.xForwardedHost);
  return new NextRequest(opts.url, { headers });
}

describe("enforceCanonicalHost (Next.js wrapper)", () => {
  let originalPublicUrl: string | undefined;
  let originalAliases: string | undefined;

  beforeEach(() => {
    originalPublicUrl = process.env.PUBLIC_URL;
    originalAliases = process.env.PUBLIC_URL_ALIASES;
  });

  afterEach(() => {
    if (originalPublicUrl === undefined) delete process.env.PUBLIC_URL;
    else process.env.PUBLIC_URL = originalPublicUrl;
    if (originalAliases === undefined) delete process.env.PUBLIC_URL_ALIASES;
    else process.env.PUBLIC_URL_ALIASES = originalAliases;
  });

  it("returns null (passthrough) when PUBLIC_URL is unset", () => {
    delete process.env.PUBLIC_URL;
    delete process.env.PUBLIC_URL_ALIASES;
    const req = buildRequest({
      url: "http://localhost:3000/foo",
      host: "localhost:3000",
    });
    expect(enforceCanonicalHost(req)).toBeNull();
  });

  it("returns null when host matches canonical", () => {
    process.env.PUBLIC_URL = "https://portal.example.com";
    const req = buildRequest({
      url: "https://portal.example.com/foo",
      host: "portal.example.com",
    });
    expect(enforceCanonicalHost(req)).toBeNull();
  });

  it('returns 301 redirect with Clear-Site-Data: "storage" for non-canonical host', () => {
    process.env.PUBLIC_URL = "https://portal.example.com";
    delete process.env.PUBLIC_URL_ALIASES;
    const req = buildRequest({
      url: "http://192.168.1.10:3000/foo",
      host: "192.168.1.10:3000",
    });
    const res = enforceCanonicalHost(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(301);
    expect(res!.headers.get("location")).toBe("https://portal.example.com/foo");
    expect(res!.headers.get("clear-site-data")).toBe('"storage"');
  });

  it("returns null when host matches PUBLIC_URL_ALIASES entry (LAN bypass)", () => {
    process.env.PUBLIC_URL = "https://portal.example.com";
    process.env.PUBLIC_URL_ALIASES = "192.168.1.10:3000";
    const req = buildRequest({
      url: "http://192.168.1.10:3000/foo",
      host: "192.168.1.10:3000",
    });
    expect(enforceCanonicalHost(req)).toBeNull();
  });

  it("prefers x-forwarded-host over host header (reverse-proxy scenario)", () => {
    process.env.PUBLIC_URL = "https://portal.example.com";
    delete process.env.PUBLIC_URL_ALIASES;
    const req = buildRequest({
      url: "http://localhost:3000/foo",
      host: "localhost:3000",
      xForwardedHost: "portal.example.com",
    });
    expect(enforceCanonicalHost(req)).toBeNull();
  });

  it("preserves path and query string in redirect target", () => {
    process.env.PUBLIC_URL = "https://portal.example.com";
    delete process.env.PUBLIC_URL_ALIASES;
    const req = buildRequest({
      url: "http://localhost:3000/foo?bar=1&baz=2",
      host: "localhost:3000",
    });
    const res = enforceCanonicalHost(req);
    expect(res!.headers.get("location")).toBe(
      "https://portal.example.com/foo?bar=1&baz=2",
    );
  });

  it.each(["/api/health", "/api/healthz", "/api/ready"])(
    "never redirects health-probe path %s (load-balancer probe protection)",
    (probePath) => {
      process.env.PUBLIC_URL = "https://portal.example.com";
      delete process.env.PUBLIC_URL_ALIASES;
      const req = buildRequest({
        url: `http://192.168.1.10:3000${probePath}`,
        host: "192.168.1.10:3000",
      });
      expect(enforceCanonicalHost(req)).toBeNull();
    },
  );

  // Regression (BI-A5842B04): setting PUBLIC_URL must never 301 the internal
  // service callbacks that arrive on the Docker service host / loopback — a
  // redirect there corrupts Inngest's signed POSTs (background jobs die) and the
  // MCP/CI JSON. Even with PUBLIC_URL set and a non-canonical host, pass through.
  it.each(["/api/inngest", "/api/mcp/v1"])(
    "never redirects internal service callback %s even with PUBLIC_URL set",
    (internalPath) => {
      process.env.PUBLIC_URL = "https://portal.example.com";
      delete process.env.PUBLIC_URL_ALIASES;
      const req = buildRequest({
        url: `http://portal:3000${internalPath}`,
        host: "portal:3000",
      });
      expect(enforceCanonicalHost(req)).toBeNull();
    },
  );

  // Regression (extends BI-A5842B04): a remote federation peer dials us at a LAN
  // address whose host form differs from PUBLIC_URL (here the operator set a
  // hostname canonical, but the peer reaches us by IP). A 301 would turn the
  // peer's signed Bearer POST into a GET — dropping the token + enrollment body
  // and failing the pairing handshake. These machine callbacks must pass through.
  it.each([
    "/api/v1/federation/enroll",
    "/api/v1/federation/approval-relay",
    "/api/v1/federation/demand",
  ])("never redirects federation peer callback %s even with PUBLIC_URL set", (peerPath) => {
    process.env.PUBLIC_URL = "http://portal.example.com:3000";
    delete process.env.PUBLIC_URL_ALIASES;
    const req = buildRequest({
      url: `http://192.168.0.200:3000${peerPath}`,
      host: "192.168.0.200:3000",
    });
    expect(enforceCanonicalHost(req)).toBeNull();
  });

  // The browser pairing UI itself is NOT exempt — an operator landing on the
  // federation-links admin page at a non-canonical host is still canonicalized.
  it("still redirects the browser federation-links page at a non-canonical host", () => {
    process.env.PUBLIC_URL = "https://portal.example.com";
    delete process.env.PUBLIC_URL_ALIASES;
    const req = buildRequest({
      url: "http://192.168.0.200:3000/platform/federation-links",
      host: "192.168.0.200:3000",
    });
    const res = enforceCanonicalHost(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(301);
    expect(res!.headers.get("location")).toBe(
      "https://portal.example.com/platform/federation-links",
    );
  });
});
