import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findClientByClientId: vi.fn(),
  resolveCimdClient: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("./oauth-clients", async () => {
  const actual = await vi.importActual<typeof import("./oauth-clients")>("./oauth-clients");
  return {
    ...actual,
    findClientByClientId: mocks.findClientByClientId,
    resolveCimdClient: mocks.resolveCimdClient,
  };
});

import { buildCodeRedirect, buildErrorRedirect, parseAuthorizeRequest } from "./oauth-authorize-request";

const ORIGIN = "http://127.0.0.1:3000";
const REDIRECT = "http://127.0.0.1:49152/callback";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

function client(overrides: Record<string, unknown> = {}) {
  return {
    rowId: "row1",
    clientId: "client1",
    clientName: "Claude Code",
    registrationKind: "dcr",
    redirectUris: [REDIRECT],
    allowedScopes: [],
    ownerUserId: null,
    agentId: null,
    clientSecretHash: null,
    selfAsserted: true,
    ...overrides,
  };
}

function params(overrides: Record<string, string | null> = {}): URLSearchParams {
  const base: Record<string, string | null> = {
    client_id: "client1",
    redirect_uri: REDIRECT,
    response_type: "code",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    resource: `${ORIGIN}/api/mcp/v1`,
    scope: "dpf.read dpf.work",
    state: "xyz",
    ...overrides,
  };
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) if (v !== null) out.set(k, v);
  return out;
}

beforeEach(() => {
  mocks.findClientByClientId.mockReset();
  mocks.resolveCimdClient.mockReset();
  mocks.findClientByClientId.mockResolvedValue(client());
});

describe("happy path", () => {
  it("accepts a well-formed request", async () => {
    const r = await parseAuthorizeRequest(params(), ORIGIN);
    expect(r.valid).toBe(true);
    if (!r.valid) return;
    expect(r.request.scopes).toEqual(["dpf.read", "dpf.work"]);
    expect(r.request.state).toBe("xyz");
    expect(r.request.redirectUri).toBe(REDIRECT);
  });

  it("defaults to the advertised read floor when no scope is requested", async () => {
    const r = await parseAuthorizeRequest(params({ scope: null }), ORIGIN);
    expect(r.valid).toBe(true);
    if (!r.valid) return;
    expect(r.request.scopes).toEqual(["dpf.read"]);
  });

  it("defaults resource to the canonical URI when the client omits it", async () => {
    const r = await parseAuthorizeRequest(params({ resource: null }), ORIGIN);
    expect(r.valid).toBe(true);
    if (!r.valid) return;
    expect(r.request.resource).toBe(`${ORIGIN}/api/mcp/v1`);
  });
});

describe("open-redirector protection", () => {
  it("refuses DIRECTLY when redirect_uri is not registered — never bounces the error", async () => {
    const r = await parseAuthorizeRequest(
      params({ redirect_uri: "https://evil.test/steal" }),
      ORIGIN,
    );
    expect(r.valid).toBe(false);
    if (r.valid) return;
    // The distinction is the whole point: a redirect-mode failure here would
    // send an attacker-chosen URL a 302 from our origin.
    expect(r.failure.mode).toBe("direct");
  });

  it("refuses directly for an unknown client too", async () => {
    mocks.findClientByClientId.mockResolvedValue(null);
    const r = await parseAuthorizeRequest(params(), ORIGIN);
    expect(r.valid).toBe(false);
    if (r.valid) return;
    expect(r.failure.mode).toBe("direct");
    expect(r.failure.error).toBe("invalid_client");
  });

  it("only bounces errors AFTER the redirect_uri is validated", async () => {
    const r = await parseAuthorizeRequest(params({ response_type: "token" }), ORIGIN);
    expect(r.valid).toBe(false);
    if (r.valid) return;
    expect(r.failure.mode).toBe("redirect");
    expect(r.failure.error).toBe("unsupported_response_type");
  });
});

describe("PKCE is mandatory", () => {
  it("refuses a missing code_challenge", async () => {
    const r = await parseAuthorizeRequest(params({ code_challenge: null }), ORIGIN);
    expect(r.valid).toBe(false);
  });

  it("refuses plain, and refuses an ABSENT method (the silent OAuth 2.0 downgrade)", async () => {
    for (const method of ["plain", null]) {
      const r = await parseAuthorizeRequest(params({ code_challenge_method: method }), ORIGIN);
      expect(r.valid, `method=${method} must be refused`).toBe(false);
    }
  });

  it("refuses a malformed challenge", async () => {
    for (const bad of ["short", "a".repeat(200), "has spaces in it!!"]) {
      const r = await parseAuthorizeRequest(params({ code_challenge: bad }), ORIGIN);
      expect(r.valid, `challenge=${bad} must be refused`).toBe(false);
    }
  });
});

describe("audience binding", () => {
  it("refuses a resource naming another installation", async () => {
    const r = await parseAuthorizeRequest(
      params({ resource: "https://other.example.com/api/mcp/v1" }),
      ORIGIN,
    );
    expect(r.valid).toBe(false);
    if (r.valid) return;
    expect(r.failure.error).toBe("invalid_target");
  });
});

describe("scope handling", () => {
  it("refuses an unknown scope rather than ignoring it", async () => {
    const r = await parseAuthorizeRequest(params({ scope: "dpf.read files:write" }), ORIGIN);
    expect(r.valid).toBe(false);
    if (r.valid) return;
    expect(r.failure.error).toBe("invalid_scope");
  });

  it("caps the request to the client's allowedScopes when the operator set them", async () => {
    mocks.findClientByClientId.mockResolvedValue(client({ allowedScopes: ["dpf.read"] }));
    const r = await parseAuthorizeRequest(params({ scope: "dpf.read dpf.admin" }), ORIGIN);
    expect(r.valid).toBe(true);
    if (!r.valid) return;
    expect(r.request.scopes).toEqual(["dpf.read"]);
  });

  it("refuses when the cap leaves nothing", async () => {
    mocks.findClientByClientId.mockResolvedValue(client({ allowedScopes: ["dpf.read"] }));
    const r = await parseAuthorizeRequest(params({ scope: "dpf.admin" }), ORIGIN);
    expect(r.valid).toBe(false);
    if (r.valid) return;
    expect(r.failure.error).toBe("invalid_scope");
  });

  it("treats an empty allowedScopes as uncapped — consent is the gate, not registration", async () => {
    const r = await parseAuthorizeRequest(params({ scope: "dpf.admin" }), ORIGIN);
    expect(r.valid).toBe(true);
    if (!r.valid) return;
    expect(r.request.scopes).toEqual(["dpf.admin"]);
  });
});

describe("CIMD dispatch", () => {
  it("resolves an https client_id through the CIMD path, not the local lookup", async () => {
    mocks.resolveCimdClient.mockResolvedValue(client({ clientId: "https://x.test/c.json" }));
    const r = await parseAuthorizeRequest(
      params({ client_id: "https://x.test/c.json" }),
      ORIGIN,
    );
    expect(mocks.resolveCimdClient).toHaveBeenCalledWith("https://x.test/c.json");
    expect(mocks.findClientByClientId).not.toHaveBeenCalled();
    expect(r.valid).toBe(true);
  });

  it("surfaces an unfetchable CIMD document as an unknown client", async () => {
    // An air-gapped install cannot fetch; reporting that honestly beats a
    // confusing partial success.
    mocks.resolveCimdClient.mockResolvedValue(null);
    const r = await parseAuthorizeRequest(params({ client_id: "https://x.test/c.json" }), ORIGIN);
    expect(r.valid).toBe(false);
  });
});

describe("redirect construction", () => {
  it("carries code and state on success", () => {
    const url = new URL(buildCodeRedirect(REDIRECT, "code123", "xyz"));
    expect(url.searchParams.get("code")).toBe("code123");
    expect(url.searchParams.get("state")).toBe("xyz");
  });

  it("omits state when the client sent none", () => {
    const url = new URL(buildCodeRedirect(REDIRECT, "code123", null));
    expect(url.searchParams.has("state")).toBe(false);
  });

  it("carries error and description on failure", () => {
    const url = new URL(
      buildErrorRedirect({
        mode: "redirect",
        redirectUri: REDIRECT,
        state: "xyz",
        error: "access_denied",
        detail: "The user declined.",
      }),
    );
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("error_description")).toBe("The user declined.");
    expect(url.searchParams.get("state")).toBe("xyz");
  });

  it("preserves a pre-existing query on the registered redirect", () => {
    const url = new URL(buildCodeRedirect("https://a.test/cb?keep=1", "c", null));
    expect(url.searchParams.get("keep")).toBe("1");
    expect(url.searchParams.get("code")).toBe("c");
  });
});
