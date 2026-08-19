import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockAgent } from "undici";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exchangeToken, AdpAuthError, resolveTokenEndpoint } from "./token-client";

const validPem = readFileSync(resolve(__dirname, "fixtures/valid-cert.pem"), "utf8");
// The token client only touches the private key via node:tls.createSecureContext
// when it builds the default mTLS Agent. Tests always inject a MockAgent via the
// `dispatcher` option, so the key bytes are never parsed here — any plausible
// PEM-looking blob is fine.
const dummyKey = `-----BEGIN PRIVATE KEY-----\nMIIBVQIBADA...(test)\n-----END PRIVATE KEY-----\n`;

describe("resolveTokenEndpoint", () => {
  it("maps sandbox to the sandbox accounts host", () => {
    expect(resolveTokenEndpoint("sandbox")).toBe(
      "https://accounts.sandbox.api.adp.com/auth/oauth/v2/token",
    );
  });

  it("maps production to the production accounts host", () => {
    expect(resolveTokenEndpoint("production")).toBe(
      "https://accounts.api.adp.com/auth/oauth/v2/token",
    );
  });
});

describe("exchangeToken", () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
  });

  afterEach(async () => {
    await mockAgent.close();
  });

  it("POSTs client_credentials and returns accessToken + expiresAt on 200", async () => {
    const pool = mockAgent.get("https://accounts.sandbox.api.adp.com");
    pool
      .intercept({
        path: "/auth/oauth/v2/token",
        method: "POST",
        headers: (headers) =>
          (headers["content-type"] ?? "").toString().includes("application/x-www-form-urlencoded"),
        body: (body) => {
          const params = new URLSearchParams(body);
          return (
            params.get("grant_type") === "client_credentials" &&
            params.get("client_id") === "test-client" &&
            params.get("client_secret") === "test-secret"
          );
        },
      })
      .reply(200, { access_token: "eyJ.fake.token", expires_in: 3600, token_type: "Bearer" });

    const before = Date.now();
    const result = await exchangeToken({
      environment: "sandbox",
      clientId: "test-client",
      clientSecret: "test-secret",
      certPem: validPem,
      privateKeyPem: dummyKey,
      dispatcher: mockAgent,
    });
    const after = Date.now();

    expect(result.accessToken).toBe("eyJ.fake.token");
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3600 * 1000 - 1000);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + 3600 * 1000 + 1000);
  });

  it("throws AdpAuthError on 401", async () => {
    const pool = mockAgent.get("https://accounts.sandbox.api.adp.com");
    pool
      .intercept({ path: "/auth/oauth/v2/token", method: "POST" })
      .reply(401, { error: "invalid_client", error_description: "Client authentication failed" });

    await expect(
      exchangeToken({
        environment: "sandbox",
        clientId: "wrong-client",
        clientSecret: "wrong-secret",
        certPem: validPem,
        privateKeyPem: dummyKey,
        dispatcher: mockAgent,
      }),
    ).rejects.toThrow(AdpAuthError);
  });

  it("redacts secret material from AdpAuthError messages", async () => {
    const pool = mockAgent.get("https://accounts.sandbox.api.adp.com");
    pool
      .intercept({ path: "/auth/oauth/v2/token", method: "POST" })
      .reply(401, { error: "invalid_client" });

    let caught: AdpAuthError | null = null;
    try {
      await exchangeToken({
        environment: "sandbox",
        clientId: "wrong-client",
        clientSecret: "super-secret-do-not-leak",
        certPem: validPem,
        privateKeyPem: dummyKey,
        dispatcher: mockAgent,
      });
    } catch (err) {
      caught = err as AdpAuthError;
    }

    expect(caught).toBeInstanceOf(AdpAuthError);
    expect(caught!.message).not.toContain("super-secret-do-not-leak");
    expect(caught!.message).not.toContain("wrong-client");
    expect(caught!.message).toMatch(/invalid client credentials/i);
  });

  it("throws AdpAuthError on 500 with generic redacted message", async () => {
    const pool = mockAgent.get("https://accounts.sandbox.api.adp.com");
    pool.intercept({ path: "/auth/oauth/v2/token", method: "POST" }).reply(500, "server down");

    await expect(
      exchangeToken({
        environment: "sandbox",
        clientId: "c",
        clientSecret: "s",
        certPem: validPem,
        privateKeyPem: dummyKey,
        dispatcher: mockAgent,
      }),
    ).rejects.toThrow(/token exchange failed|server error|unexpected/i);
  });

  it("throws AdpAuthError when response is missing access_token", async () => {
    const pool = mockAgent.get("https://accounts.sandbox.api.adp.com");
    pool
      .intercept({ path: "/auth/oauth/v2/token", method: "POST" })
      .reply(200, { token_type: "Bearer" });

    await expect(
      exchangeToken({
        environment: "sandbox",
        clientId: "c",
        clientSecret: "s",
        certPem: validPem,
        privateKeyPem: dummyKey,
        dispatcher: mockAgent,
      }),
    ).rejects.toThrow(AdpAuthError);
  });

  it("routes production env to the production token endpoint", async () => {
    const pool = mockAgent.get("https://accounts.api.adp.com");
    pool
      .intercept({ path: "/auth/oauth/v2/token", method: "POST" })
      .reply(200, { access_token: "prod.token", expires_in: 3600 });

    const result = await exchangeToken({
      environment: "production",
      clientId: "c",
      clientSecret: "s",
      certPem: validPem,
      privateKeyPem: dummyKey,
      dispatcher: mockAgent,
    });
    expect(result.accessToken).toBe("prod.token");
  });
});
