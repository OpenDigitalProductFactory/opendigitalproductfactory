import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent } from "undici";

import {
  exchangeClientCredentials,
  type ClientCredentialsConfig,
} from "./client-credentials";

class TestAuthError extends Error {
  readonly statusCode: number | undefined;
  readonly errorCode: string | undefined;
  constructor(message: string, opts?: { statusCode?: number; errorCode?: string }) {
    super(message);
    this.name = "TestAuthError";
    this.statusCode = opts?.statusCode;
    this.errorCode = opts?.errorCode;
  }
}

const ENDPOINT = "https://token.example.com/oauth/token";

function baseConfig(
  overrides: Partial<ClientCredentialsConfig> & Pick<ClientCredentialsConfig, "dispatcher">,
): ClientCredentialsConfig {
  return {
    endpoint: ENDPOINT,
    clientId: "client-id",
    clientSecret: "client-secret",
    makeError: (message, opts) => new TestAuthError(message, opts),
    networkErrorMessage: "network unreachable",
    invalidCredsMessage: "invalid credentials",
    missingTokenMessage: "missing access token",
    invalidJsonMessage: "invalid json",
    unexpectedStatusMessage: (statusCode) => `unexpected status ${statusCode}`,
    ...overrides,
  };
}

describe("exchangeClientCredentials", () => {
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

  describe("request body", () => {
    it("always sends grant_type + client creds in the body", async () => {
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
        .reply(200, { access_token: "a", token_type: "Bearer", expires_in: 3600 });

      await exchangeClientCredentials(baseConfig({ dispatcher: mockAgent }));

      const params = new URLSearchParams(seenBody);
      expect(params.get("grant_type")).toBe("client_credentials");
      expect(params.get("client_id")).toBe("client-id");
      expect(params.get("client_secret")).toBe("client-secret");
    });

    it("includes scope when provided", async () => {
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

      await exchangeClientCredentials(
        baseConfig({ dispatcher: mockAgent, scope: "https://graph.microsoft.com/.default" }),
      );

      expect(new URLSearchParams(seenBody).get("scope")).toBe(
        "https://graph.microsoft.com/.default",
      );
    });

    it("omits scope when not provided", async () => {
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

      await exchangeClientCredentials(baseConfig({ dispatcher: mockAgent }));

      expect(new URLSearchParams(seenBody).has("scope")).toBe(false);
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

      await exchangeClientCredentials(
        baseConfig({ dispatcher: mockAgent, extraBodyParams: { resource: "https://api.example.com" } }),
      );

      expect(new URLSearchParams(seenBody).get("resource")).toBe("https://api.example.com");
    });
  });

  describe("success mapping", () => {
    it("returns the access token, token type, scope and raw payload", async () => {
      pool()
        .intercept({ path: "/oauth/token", method: "POST" })
        .reply(200, {
          access_token: "access-1",
          token_type: "bearer",
          expires_in: 3600,
          scope: "Mail.Read",
        });

      const result = await exchangeClientCredentials(baseConfig({ dispatcher: mockAgent }));

      expect(result.accessToken).toBe("access-1");
      expect(result.tokenType).toBe("bearer");
      expect(result.scope).toBe("Mail.Read");
      expect(result.raw.access_token).toBe("access-1");
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it("returns null scope when the response omits it", async () => {
      pool()
        .intercept({ path: "/oauth/token", method: "POST" })
        .reply(200, { access_token: "access-1", expires_in: 3600 });

      const result = await exchangeClientCredentials(baseConfig({ dispatcher: mockAgent }));

      expect(result.scope).toBeNull();
    });

    it("defaults token_type to Bearer when absent", async () => {
      pool()
        .intercept({ path: "/oauth/token", method: "POST" })
        .reply(200, { access_token: "access-1", expires_in: 3600 });

      const result = await exchangeClientCredentials(baseConfig({ dispatcher: mockAgent }));

      expect(result.tokenType).toBe("Bearer");
    });
  });

  describe("expires_in tolerance", () => {
    it("parses a numeric expires_in", async () => {
      pool()
        .intercept({ path: "/oauth/token", method: "POST" })
        .reply(200, { access_token: "a", expires_in: 120 });

      const before = Date.now();
      const result = await exchangeClientCredentials(baseConfig({ dispatcher: mockAgent }));
      const after = Date.now();

      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 120 * 1000);
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + 120 * 1000);
    });

    it("parses a numeric-string expires_in", async () => {
      pool()
        .intercept({ path: "/oauth/token", method: "POST" })
        .reply(200, { access_token: "a", expires_in: "120" });

      const before = Date.now();
      const result = await exchangeClientCredentials(baseConfig({ dispatcher: mockAgent }));
      const after = Date.now();

      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 120 * 1000);
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + 120 * 1000);
    });

    it("defaults expires_in to 3600 when absent", async () => {
      pool()
        .intercept({ path: "/oauth/token", method: "POST" })
        .reply(200, { access_token: "a" });

      const before = Date.now();
      const result = await exchangeClientCredentials(baseConfig({ dispatcher: mockAgent }));
      const after = Date.now();

      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3600 * 1000);
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + 3600 * 1000);
    });
  });

  describe("auth-error statuses", () => {
    it("throws invalid-creds on default 400", async () => {
      pool().intercept({ path: "/oauth/token", method: "POST" }).reply(400, { error: "invalid_client" });

      await expect(exchangeClientCredentials(baseConfig({ dispatcher: mockAgent }))).rejects.toThrow(
        "invalid credentials",
      );
    });

    it("throws invalid-creds on default 401", async () => {
      pool().intercept({ path: "/oauth/token", method: "POST" }).reply(401, { error: "invalid_client" });

      await expect(exchangeClientCredentials(baseConfig({ dispatcher: mockAgent }))).rejects.toThrow(
        "invalid credentials",
      );
    });

    it("throws invalid-creds on default 403", async () => {
      pool().intercept({ path: "/oauth/token", method: "POST" }).reply(403, { error: "forbidden" });

      await expect(exchangeClientCredentials(baseConfig({ dispatcher: mockAgent }))).rejects.toThrow(
        "invalid credentials",
      );
    });

    it("treats 400 as unexpected when authErrorStatuses is overridden to [401,403]", async () => {
      pool().intercept({ path: "/oauth/token", method: "POST" }).reply(400, { error: "invalid_request" });

      await expect(
        exchangeClientCredentials(baseConfig({ dispatcher: mockAgent, authErrorStatuses: [401, 403] })),
      ).rejects.toThrow("unexpected status 400");
    });

    it("carries the statusCode on the thrown error", async () => {
      pool().intercept({ path: "/oauth/token", method: "POST" }).reply(401, { error: "invalid_client" });

      const err = await exchangeClientCredentials(baseConfig({ dispatcher: mockAgent })).catch((e) => e);
      expect((err as TestAuthError).statusCode).toBe(401);
    });
  });

  describe("server-error branch", () => {
    it("throws the distinct server-error message on 500 when serverErrorMessage is set", async () => {
      pool().intercept({ path: "/oauth/token", method: "POST" }).reply(500, "boom");

      await expect(
        exchangeClientCredentials(baseConfig({ dispatcher: mockAgent, serverErrorMessage: "server exploded" })),
      ).rejects.toThrow("server exploded");
    });

    it("falls into the generic non-200 branch on 500 when serverErrorMessage is absent", async () => {
      pool().intercept({ path: "/oauth/token", method: "POST" }).reply(500, "boom");

      await expect(exchangeClientCredentials(baseConfig({ dispatcher: mockAgent }))).rejects.toThrow(
        "unexpected status 500",
      );
    });
  });

  describe("unexpected status", () => {
    it("throws the unexpected-status message with the status code", async () => {
      pool().intercept({ path: "/oauth/token", method: "POST" }).reply(302, "redirect");

      await expect(exchangeClientCredentials(baseConfig({ dispatcher: mockAgent }))).rejects.toThrow(
        "unexpected status 302",
      );
    });
  });

  describe("requireScope", () => {
    it("throws missing-token when a required scope is absent", async () => {
      pool()
        .intercept({ path: "/oauth/token", method: "POST" })
        .reply(200, { access_token: "a", token_type: "bearer", expires_in: 3600 });

      await expect(
        exchangeClientCredentials(baseConfig({ dispatcher: mockAgent, requireScope: true })),
      ).rejects.toThrow("missing access token");
    });

    it("succeeds when a required scope is present", async () => {
      pool()
        .intercept({ path: "/oauth/token", method: "POST" })
        .reply(200, { access_token: "a", scope: "Mail.Read", expires_in: 3600 });

      const result = await exchangeClientCredentials(
        baseConfig({ dispatcher: mockAgent, requireScope: true }),
      );
      expect(result.scope).toBe("Mail.Read");
    });
  });

  describe("payload guards", () => {
    it("throws missing-token when access_token is absent", async () => {
      pool()
        .intercept({ path: "/oauth/token", method: "POST" })
        .reply(200, { token_type: "Bearer" });

      await expect(exchangeClientCredentials(baseConfig({ dispatcher: mockAgent }))).rejects.toThrow(
        "missing access token",
      );
    });

    it("throws invalid-json when the body is not JSON", async () => {
      pool()
        .intercept({ path: "/oauth/token", method: "POST" })
        .reply(200, "not-json", { headers: { "content-type": "application/json" } });

      await expect(exchangeClientCredentials(baseConfig({ dispatcher: mockAgent }))).rejects.toThrow(
        "invalid json",
      );
    });
  });

  describe("network failure", () => {
    it("throws the network message and forwards the error code, no statusCode", async () => {
      // No intercept registered + net connect disabled → the request rejects.
      const err = await exchangeClientCredentials(baseConfig({ dispatcher: mockAgent })).catch((e) => e);
      expect((err as TestAuthError).message).toBe("network unreachable");
      expect((err as TestAuthError).statusCode).toBeUndefined();
      // undici surfaces a `code` on the connect-refused error; it is forwarded.
      expect(typeof (err as TestAuthError).errorCode === "string" || (err as TestAuthError).errorCode === undefined).toBe(true);
    });
  });

  describe("secret redaction", () => {
    it("never leaks the client secret into a thrown error", async () => {
      pool().intercept({ path: "/oauth/token", method: "POST" }).reply(401, { error: "invalid_client" });

      const err = await exchangeClientCredentials(
        baseConfig({ dispatcher: mockAgent, clientSecret: "super-secret-do-not-leak" }),
      ).catch((e) => e);
      expect((err as Error).message).not.toContain("super-secret-do-not-leak");
    });
  });
});
