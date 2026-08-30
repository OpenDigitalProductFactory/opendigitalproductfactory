import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  AS_METADATA_PATH,
  PRM_PATH_ROOT,
  PRM_PATH_SUFFIXED,
  buildAuthorizationServerMetadata,
  buildInsufficientScopeChallenge,
  buildProtectedResourceMetadata,
  buildUnauthorizedChallenge,
  canonicalResourceUri,
  isLoopbackHostname,
  resolveResourceOrigin,
  resourceMatches,
} from "./oauth-metadata";

const ORIGIN = "http://127.0.0.1:3000";

function req(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

const SAVED = { ...process.env };
beforeEach(() => {
  delete process.env.NEXT_PUBLIC_BASE_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.PUBLIC_URL;
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe("canonical resource URI", () => {
  it("is the MCP transport path on the install origin", () => {
    expect(canonicalResourceUri(ORIGIN)).toBe("http://127.0.0.1:3000/api/mcp/v1");
  });

  it("tolerates a trailing slash on the origin", () => {
    expect(canonicalResourceUri("http://127.0.0.1:3000/")).toBe(canonicalResourceUri(ORIGIN));
    expect(canonicalResourceUri("http://127.0.0.1:3000///")).toBe(canonicalResourceUri(ORIGIN));
  });
});

describe("resource matching (RFC 8707 audience binding)", () => {
  it("accepts the canonical URI", () => {
    expect(resourceMatches("http://127.0.0.1:3000/api/mcp/v1", ORIGIN)).toBe(true);
  });

  it("accepts a trailing slash and case-different host", () => {
    expect(resourceMatches("http://127.0.0.1:3000/api/mcp/v1/", ORIGIN)).toBe(true);
    expect(resourceMatches("HTTP://127.0.0.1:3000/api/mcp/v1", ORIGIN)).toBe(true);
  });

  it("treats a default port as equivalent to no port", () => {
    expect(resourceMatches("https://mcp.example.com:443/api/mcp/v1", "https://mcp.example.com")).toBe(true);
    expect(resourceMatches("http://mcp.example.com:80/api/mcp/v1", "http://mcp.example.com")).toBe(true);
  });

  it("REFUSES another install — this is what stops cross-install replay", () => {
    expect(resourceMatches("http://127.0.0.1:3000/api/mcp/v1", "http://other.example.com")).toBe(false);
    expect(resourceMatches("http://evil.example/api/mcp/v1", ORIGIN)).toBe(false);
  });

  it("refuses a different port, scheme or path", () => {
    expect(resourceMatches("http://127.0.0.1:3001/api/mcp/v1", ORIGIN)).toBe(false);
    expect(resourceMatches("https://127.0.0.1:3000/api/mcp/v1", ORIGIN)).toBe(false);
    expect(resourceMatches("http://127.0.0.1:3000/api/mcp/v2", ORIGIN)).toBe(false);
  });

  it("refuses a resource carrying a query or fragment", () => {
    expect(resourceMatches("http://127.0.0.1:3000/api/mcp/v1?tier=full", ORIGIN)).toBe(false);
    expect(resourceMatches("http://127.0.0.1:3000/api/mcp/v1#x", ORIGIN)).toBe(false);
  });

  it("refuses garbage rather than throwing", () => {
    expect(resourceMatches("not a url", ORIGIN)).toBe(false);
    expect(resourceMatches("", ORIGIN)).toBe(false);
  });
});

describe("origin resolution", () => {
  it("prefers configured base URL over the Host header", () => {
    process.env.PUBLIC_URL = "https://dpf.example.com";
    const origin = resolveResourceOrigin(req("http://attacker.example/api/mcp/v1", { host: "attacker.example" }));
    expect(origin).toBe("https://dpf.example.com");
  });

  it("falls back to a LOOPBACK Host when nothing is configured", () => {
    expect(resolveResourceOrigin(req("http://127.0.0.1:3000/x", { host: "127.0.0.1:3000" }))).toBe(
      "http://127.0.0.1:3000",
    );
  });

  it("REFUSES to trust a non-loopback Host when nothing is configured", () => {
    // Trusting Host here would let a caller make us advertise an origin we
    // cannot vouch for — classic host-header injection.
    expect(resolveResourceOrigin(req("http://evil.example/x", { host: "evil.example" }))).toBeNull();
  });

  it("honours x-forwarded-proto for a loopback fallback", () => {
    const origin = resolveResourceOrigin(
      req("http://localhost:3000/x", { host: "localhost:3000", "x-forwarded-proto": "https" }),
    );
    expect(origin).toBe("https://localhost:3000");
  });
});

describe("loopback classification", () => {
  it("recognises the three loopback forms and nothing else", () => {
    for (const h of ["localhost", "127.0.0.1", "::1", "LOCALHOST"]) {
      expect(isLoopbackHostname(h)).toBe(true);
    }
    for (const h of ["example.com", "127.0.0.1.evil.com", "0.0.0.0", "10.0.0.1"]) {
      expect(isLoopbackHostname(h)).toBe(false);
    }
  });
});

describe("Protected Resource Metadata (RFC 9728)", () => {
  const doc = buildProtectedResourceMetadata(ORIGIN);

  it("names the canonical resource and at least one authorization server", () => {
    expect(doc.resource).toBe(canonicalResourceUri(ORIGIN));
    expect(doc.authorization_servers.length).toBeGreaterThanOrEqual(1);
    expect(doc.authorization_servers[0]).toBe(ORIGIN);
  });

  it("advertises the read floor only", () => {
    expect(doc.scopes_supported).toEqual(["dpf.read"]);
  });

  it("advertises header-only bearer methods (never a query string)", () => {
    expect(doc.bearer_methods_supported).toEqual(["header"]);
  });
});

describe("Authorization Server Metadata (RFC 8414)", () => {
  it("advertises S256 only — no plain, no downgrade", () => {
    const doc = buildAuthorizationServerMetadata(ORIGIN, { registrationEnabled: true });
    expect(doc.code_challenge_methods_supported).toEqual(["S256"]);
  });

  it("advertises all three grant types", () => {
    const doc = buildAuthorizationServerMetadata(ORIGIN, { registrationEnabled: true });
    expect(doc.grant_types_supported).toContain("authorization_code");
    expect(doc.grant_types_supported).toContain("refresh_token");
    expect(doc.grant_types_supported).toContain("client_credentials");
  });

  it("omits registration_endpoint when DCR is disabled", () => {
    // The spec's client priority order keys off presence, so advertising an
    // endpoint that refuses everything is worse than omitting it.
    const off = buildAuthorizationServerMetadata(ORIGIN, { registrationEnabled: false });
    expect(off.registration_endpoint).toBeUndefined();
    const on = buildAuthorizationServerMetadata(ORIGIN, { registrationEnabled: true });
    expect(on.registration_endpoint).toBe(`${ORIGIN}/api/oauth/register`);
  });

  it("points every endpoint at the issuer origin", () => {
    const doc = buildAuthorizationServerMetadata(ORIGIN, { registrationEnabled: true });
    expect(doc.issuer).toBe(ORIGIN);
    for (const ep of [doc.authorization_endpoint, doc.token_endpoint, doc.revocation_endpoint]) {
      expect(ep.startsWith(ORIGIN)).toBe(true);
    }
  });

  it("advertises the whole vocabulary, unlike the PRM read floor", () => {
    const doc = buildAuthorizationServerMetadata(ORIGIN, { registrationEnabled: false });
    expect(doc.scopes_supported).toContain("dpf.read");
    expect(doc.scopes_supported).toContain("dpf.admin");
  });
});

describe("401 challenge — the parameter whose absence was the whole defect", () => {
  it("carries resource_metadata pointing at the path-suffixed document", () => {
    const h = buildUnauthorizedChallenge(ORIGIN, "missing Bearer token");
    expect(h).toContain(`resource_metadata="${ORIGIN}${PRM_PATH_SUFFIXED}"`);
  });

  it("carries the least-privilege scope hint", () => {
    expect(buildUnauthorizedChallenge(ORIGIN, "nope")).toContain('scope="dpf.read"');
  });

  it("still returns a parseable Bearer challenge with no resolvable origin", () => {
    const h = buildUnauthorizedChallenge(null, "nope");
    expect(h.startsWith("Bearer ")).toBe(true);
    expect(h).not.toContain("resource_metadata");
  });

  it("strips quotes and newlines so a detail cannot break the header", () => {
    const h = buildUnauthorizedChallenge(ORIGIN, 'evil" , x="y\r\ninjected');
    expect(h).not.toContain("\r");
    expect(h).not.toContain("\n");
    expect(h.match(/error_description="[^"]*"/)).toBeTruthy();
  });
});

describe("403 insufficient_scope challenge (step-up)", () => {
  it("includes granted PLUS required scopes, per the recommended strategy", () => {
    const h = buildInsufficientScopeChallenge(ORIGIN, {
      granted: ["dpf.read"],
      required: ["dpf.work"],
      detail: "needs more",
    });
    expect(h).toContain('error="insufficient_scope"');
    expect(h).toContain("dpf.read");
    expect(h).toContain("dpf.work");
  });

  it("does not duplicate a scope already held", () => {
    const h = buildInsufficientScopeChallenge(ORIGIN, {
      granted: ["dpf.read", "dpf.work"],
      required: ["dpf.work"],
      detail: "x",
    });
    const scope = h.match(/scope="([^"]+)"/)?.[1] ?? "";
    expect(scope.split(" ").filter((s) => s === "dpf.work")).toHaveLength(1);
  });

  it("points back at the metadata document for consistency with the 401", () => {
    const h = buildInsufficientScopeChallenge(ORIGIN, {
      granted: [],
      required: ["dpf.build"],
      detail: "x",
    });
    expect(h).toContain(`resource_metadata="${ORIGIN}${PRM_PATH_SUFFIXED}"`);
  });
});

describe("well-known paths", () => {
  it("uses the spec's path-suffixed form (well-known BEFORE the resource path)", () => {
    expect(PRM_PATH_SUFFIXED).toBe("/.well-known/oauth-protected-resource/api/mcp/v1");
    expect(PRM_PATH_ROOT).toBe("/.well-known/oauth-protected-resource");
    expect(AS_METADATA_PATH).toBe("/.well-known/oauth-authorization-server");
  });
});
