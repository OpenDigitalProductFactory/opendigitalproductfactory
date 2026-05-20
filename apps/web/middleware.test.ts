import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

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

describe("middleware (canonical-URL enforcement)", () => {
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

  it("passes through when PUBLIC_URL is unset (bootstrap-before-DNS)", async () => {
    delete process.env.PUBLIC_URL;
    delete process.env.PUBLIC_URL_ALIASES;
    const req = buildRequest({
      url: "http://localhost:3000/foo",
      host: "localhost:3000",
    });
    const res = await middleware(req);
    // NextResponse.next() returns a 200 response with no Location header.
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("clear-site-data")).toBeNull();
  });

  it("passes through when host matches canonical", async () => {
    process.env.PUBLIC_URL = "https://portal.example.com";
    const req = buildRequest({
      url: "https://portal.example.com/foo",
      host: "portal.example.com",
    });
    const res = await middleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("301-redirects non-canonical host to canonical with Clear-Site-Data: \"storage\"", async () => {
    process.env.PUBLIC_URL = "https://portal.example.com";
    delete process.env.PUBLIC_URL_ALIASES;
    const req = buildRequest({
      url: "http://192.168.1.10:3000/foo",
      host: "192.168.1.10:3000",
    });
    const res = await middleware(req);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://portal.example.com/foo");
    expect(res.headers.get("clear-site-data")).toBe('"storage"');
  });

  it("passes through when host matches PUBLIC_URL_ALIASES entry (LAN bypass)", async () => {
    process.env.PUBLIC_URL = "https://portal.example.com";
    process.env.PUBLIC_URL_ALIASES = "192.168.1.10:3000";
    const req = buildRequest({
      url: "http://192.168.1.10:3000/foo",
      host: "192.168.1.10:3000",
    });
    const res = await middleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("prefers x-forwarded-host over host header (reverse-proxy scenario)", async () => {
    process.env.PUBLIC_URL = "https://portal.example.com";
    delete process.env.PUBLIC_URL_ALIASES;
    // Internal request reports host=localhost but the real client hit portal.example.com.
    const req = buildRequest({
      url: "http://localhost:3000/foo",
      host: "localhost:3000",
      xForwardedHost: "portal.example.com",
    });
    const res = await middleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("preserves path and query string in redirect target", async () => {
    process.env.PUBLIC_URL = "https://portal.example.com";
    delete process.env.PUBLIC_URL_ALIASES;
    const req = buildRequest({
      url: "http://localhost:3000/foo?bar=1&baz=2",
      host: "localhost:3000",
    });
    const res = await middleware(req);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(
      "https://portal.example.com/foo?bar=1&baz=2",
    );
  });
});
