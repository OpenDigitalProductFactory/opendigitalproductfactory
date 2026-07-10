import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent } from "undici";

import { refreshOAuthToken, type OAuthRefreshConfig } from "./oauth-refresh";

class TestAuthError extends Error {
  readonly statusCode: number | undefined;
  constructor(message: string, opts?: { statusCode?: number }) {
    super(message);
    this.name = "TestAuthError";
    this.statusCode = opts?.statusCode;
  }
}

const ENDPOINT = "https://token.example.com/oauth/token";

function baseConfig(
  overrides: Partial<OAuthRefreshConfig> & Pick<OAuthRefreshConfig, "dispatcher">,
): OAuthRefreshConfig {
  return {
    endpoint: ENDPOINT,
    clientId: "client-id",
    clientSecret: "client-secret",
    refreshToken: "refresh-token-123",
    credentialPlacement: "basic-header",
    makeError: (message, opts) => new TestAuthError(message, opts),
    networkErrorMessage: "network unreachable",
    invalidCredsMessage: "invalid credentials",
    missingTokenMessage: "missing access token",
    invalidJsonMessage: "invalid json",
    unexpectedStatusMessage: (statusCode) => `unexpected status ${statusCode}`,
    ...overrides,
  };
}

describe("refreshOAuthToken", () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
  });

  afterEach(async () => {
    await mockAgent.close();
  });

  function pool() {
    return mockAgent.get("https://token.example.com");
  }

  describe("credential placement", () => {
    it("sends Basic-auth header and no client creds in the body", async () => {
      let seenAuth = "";
      let seenBody = "";
      pool()
        .intercept({
          path: "/oauth/token",
          method: "POST",
          headers: (headers) => {
            seenAuth = String(headers.authorization ?? "");
            return true;
          },
          body: (body) => {
            seenBody = String(body);
            return true;
          },
        })
        .reply(200, { access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600 });

      await refreshOAuthToken(baseConfig({ dispatcher: mockAgent, credentialPlacement: "basic-header" }));

      expect(seenAuth.startsWith("Basic ")).toBe(true);
      const decoded = Buffer.from(seenAuth.slice("Basic ".length), "base64").toString("utf8");
      expect(decoded).toBe("client-id:client-secret");
      const params = new URLSearchParams(seenBody);
      expect(params.get("grant_type")).toBe("refresh_token");
      expect(params.get("refresh_token")).toBe("refresh-token-123");
      expect(params.get("client_id")).toBeNull();
      expect(params.get("client_secret")).toBeNull();
    });

    it("puts client creds in the body and sends no Basic header", async () => {
      let seenAuth: string | undefined = "unset";
      let seenBody = "";
      pool()
        .intercept({
          path: "/oauth/token",
          method: "POST",
          headers: (headers) => {
            seenAuth = headers.authorization as string | undefined;
            return true;
          },
          body: (body) => {
            seenBody = String(body);
            return true;
          },
        })
        .reply(200, { access_token: "a", token_type: "Bearer", expires_in: 3600 });

      await refreshOAuthToken(baseConfig({ dispatcher: mockAgent, credentialPlacement: "body" }));

      expect(seenAuth).toBeUndefined();
      const params = new URLSearchParams(seenBody);
      expect(params.get("client_id")).toBe("client-id");
      expect(params.get("client_secret")).toBe("client-secret");
      expect(params.get("grant_type")).toBe("refresh_token");
    });

    it("merges extraBodyParams", async () => {
      let seenBody = "";
      pool()
        .intercept({
          path: "/oauth/token",
          method: "POST",
          body: (body) => {
            seenBody = String(body);
            return true;
          },
        })
        .reply(200, { access_token: "a", expires_in: 3600 });

      await refreshOAuthToken(
        baseConfig({ dispatcher: mockAgent, extraBodyParams: { audience: "https://api.example.com" } }),
      );

      expect(new URLSearchParams(seenBody).get("audience")).toBe("https://api.example.com");
    });
  });

  describe("success mapping", () => {
    it("returns the rotated refresh token, token type, scope and raw payload", async () => {
      pool()
        .intercept({ path: "/oauth/token", method: "POST" })
        .reply(200, {
          access_token: "access-1",
          refresh_token: "rotated-1",
          token_type: "bearer",
          expires_in: 3600,
          scope: "read write",
        });

      const result = await refreshOAuthToken(baseConfig({ dispatcher: mockAgent }));

      expect(result.accessToken).toBe("access-1");
      expect(result.refreshToken).toBe("rotated-1");
      expect(result.tokenType).toBe("bearer");
      expect(result.scope).toBe("read write");
      expect(result.raw.access_token).toBe("access-1");
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it("returns null refreshToken and null scope when the response omits them", async () => {
      pool()
        .intercept({ path: "/oauth/token", method: "POST" })
        .reply(200, { access_token: "access-1", expires_in: 3600 });

      const result = await refreshOAuthToken(baseConfig({ dispatcher: mockAgent }));

      expect(result.refreshToken).toBeNull();
      expect(result.scope).toBeNull();
    });

    it("defaults token_type to Bearer when absent", async () => {
      pool()
        .intercept({ path: "/oauth/token", method: "POST" })
        .reply(200, { access_token: "access-1", expires_in: 3600 });

      const result = await refreshOAuthToken(baseConfig({ dispatcher: mockAgent }));

      expect(result.tokenType).toBe("Bearer");
    });
  });

  describe("expires_in tolerance", () => {
    it("parses a numeric expires_in", async () => {
      pool()
        .intercept({ path: "/oauth/token", method: "POST" })
        .reply(200, { access_token: "a", expires_in: 120 });

      const before = Date.now();
      const result = await refreshOAuthToken(baseConfig({ dispatcher: mockAgent }));
      const after = Date.now();

      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 120 * 1000);
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + 120 * 1000);
    });

    it("parses a numeric-string expires_in", async () => {
      pool()
        .intercept({ path: "/oauth/token", method: "POST" })
        .reply(200, { access_token: "a", expires_in: "120" });

      const before = Date.now();
      const result = await refreshOAuthToken(baseConfig({ dispatcher: mockAgent }));
      const after = Date.now();

      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 120 * 1000);
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + 120 * 1000);
    });

    it("defaults expires_in to 3600 when absent", async () => {
      pool()
        .intercept({ path: "/oauth/token", method: "POST" })
        .reply(200, { access_token: "a" });

      const before = Date.now();
      const result = await refreshOAuthToken(baseConfig({ dispatcher: mockAgent }));
      const after = Date.now();

      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3600 * 1000);
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + 3600 * 1000);
    });
  });

  describe("auth-error statuses", () => {
    it("throws invalid-creds on default 401", async () => {
      pool().intercept({ path: "/oauth/token", method: "POST" }).reply(401, { error: "invalid_client" });

      await expect(refreshOAuthToken(baseConfig({ dispatcher: mockAgent }))).rejects.toThrow(
        "invalid credentials",
      );
    });

    it("throws invalid-creds on default 403", async () => {
      pool().intercept({ path: "/oauth/token", method: "POST" }).reply(403, { error: "forbidden" });

      await expect(refreshOAuthToken(baseConfig({ dispatcher: mockAgent }))).rejects.toThrow(
        "invalid credentials",
      );
    });

    it("treats a custom status (Google's 400) as invalid-creds", async () => {
      pool().intercept({ path: "/oauth/token", method: "POST" }).reply(400, { error: "invalid_grant" });

      await expect(
        refreshOAuthToken(baseConfig({ dispatcher: mockAgent, authErrorStatuses: [400, 401, 403] })),
      ).rejects.toThrow("invalid credentials");
    });

    it("carries the statusCode on the thrown error", async () => {
      pool().intercept({ path: "/oauth/token", method: "POST" }).reply(401, { error: "invalid_client" });

      const err = await refreshOAuthToken(baseConfig({ dispatcher: mockAgent })).catch((e) => e);
      expect((err as TestAuthError).statusCode).toBe(401);
    });
  });

  describe("server-error branch", () => {
    it("throws the distinct server-error message on 500 when serverErrorMessage is set", async () => {
      pool().intercept({ path: "/oauth/token", method: "POST" }).reply(500, "boom");

      await expect(
        refreshOAuthToken(baseConfig({ dispatcher: mockAgent, serverErrorMessage: "server exploded" })),
      ).rejects.toThrow("server exploded");
    });

    it("falls into the generic non-200 branch on 500 when serverErrorMessage is absent", async () => {
      pool().intercept({ path: "/oauth/token", method: "POST" }).reply(500, "boom");

      await expect(refreshOAuthToken(baseConfig({ dispatcher: mockAgent }))).rejects.toThrow(
        "unexpected status 500",
      );
    });
  });

  describe("unexpected status", () => {
    it("throws the unexpected-status message with the status code", async () => {
      pool().intercept({ path: "/oauth/token", method: "POST" }).reply(302, "redirect");

      await expect(refreshOAuthToken(baseConfig({ dispatcher: mockAgent }))).rejects.toThrow(
        "unexpected status 302",
      );
    });
  });

  describe("requireRefreshToken", () => {
    it("throws missing-token when a required refresh_token is absent", async () => {
      pool()
        .intercept({ path: "/oauth/token", method: "POST" })
        .reply(200, { access_token: "a", token_type: "bearer", expires_in: 3600 });

      await expect(
        refreshOAuthToken(baseConfig({ dispatcher: mockAgent, requireRefreshToken: true })),
      ).rejects.toThrow("missing access token");
    });

    it("succeeds when a required refresh_token is present", async () => {
      pool()
        .intercept({ path: "/oauth/token", method: "POST" })
        .reply(200, { access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600 });

      const result = await refreshOAuthToken(
        baseConfig({ dispatcher: mockAgent, requireRefreshToken: true }),
      );
      expect(result.refreshToken).toBe("r");
    });

    it("does not require a refresh_token when requireRefreshToken is false", async () => {
      pool()
        .intercept({ path: "/oauth/token", method: "POST" })
        .reply(200, { access_token: "a", expires_in: 3600 });

      const result = await refreshOAuthToken(baseConfig({ dispatcher: mockAgent }));
      expect(result.accessToken).toBe("a");
      expect(result.refreshToken).toBeNull();
    });
  });

  describe("payload guards", () => {
    it("throws missing-token when access_token is absent", async () => {
      pool()
        .intercept({ path: "/oauth/token", method: "POST" })
        .reply(200, { refresh_token: "r" });

      await expect(refreshOAuthToken(baseConfig({ dispatcher: mockAgent }))).rejects.toThrow(
        "missing access token",
      );
    });

    it("throws invalid-json when the body is not JSON", async () => {
      pool()
        .intercept({ path: "/oauth/token", method: "POST" })
        .reply(200, "not-json", { headers: { "content-type": "application/json" } });

      await expect(refreshOAuthToken(baseConfig({ dispatcher: mockAgent }))).rejects.toThrow(
        "invalid json",
      );
    });
  });

  describe("network failure", () => {
    it("throws the network message and does not attach a statusCode", async () => {
      // No intercept registered + net connect disabled → the request rejects.
      const err = await refreshOAuthToken(baseConfig({ dispatcher: mockAgent })).catch((e) => e);
      expect((err as TestAuthError).message).toBe("network unreachable");
      expect((err as TestAuthError).statusCode).toBeUndefined();
    });
  });

  describe("secret redaction", () => {
    it("never leaks the client secret into a thrown error", async () => {
      pool().intercept({ path: "/oauth/token", method: "POST" }).reply(401, { error: "invalid_client" });

      const err = await refreshOAuthToken(
        baseConfig({ dispatcher: mockAgent, clientSecret: "super-secret-do-not-leak" }),
      ).catch((e) => e);
      expect((err as Error).message).not.toContain("super-secret-do-not-leak");
    });
  });
});
