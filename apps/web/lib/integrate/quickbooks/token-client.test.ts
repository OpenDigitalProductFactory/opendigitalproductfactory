import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent } from "undici";

import {
  QuickBooksAuthError,
  exchangeRefreshToken,
  resolveTokenEndpoint,
} from "./token-client";

describe("resolveTokenEndpoint", () => {
  const original = process.env.QUICKBOOKS_TOKEN_ENDPOINT_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.QUICKBOOKS_TOKEN_ENDPOINT_URL;
    } else {
      process.env.QUICKBOOKS_TOKEN_ENDPOINT_URL = original;
    }
  });

  it("uses the official Intuit OAuth endpoint by default", () => {
    delete process.env.QUICKBOOKS_TOKEN_ENDPOINT_URL;
    expect(resolveTokenEndpoint()).toBe("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer");
  });

  it("honors an explicit token endpoint override for harness tests", () => {
    process.env.QUICKBOOKS_TOKEN_ENDPOINT_URL = "http://integration-test-harness:8700/oauth2/v1/tokens/bearer";
    expect(resolveTokenEndpoint()).toBe("http://integration-test-harness:8700/oauth2/v1/tokens/bearer");
  });
});

describe("exchangeRefreshToken", () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
  });

  afterEach(async () => {
    await mockAgent.close();
  });

  it("posts a refresh-token grant and returns the exchanged tokens", async () => {
    mockAgent
      .get("https://oauth.platform.intuit.com")
      .intercept({
        path: "/oauth2/v1/tokens/bearer",
        method: "POST",
        headers: (headers) => {
          const auth = String(headers.authorization ?? "");
          return auth.startsWith("Basic ");
        },
        body: (body) => {
          const params = new URLSearchParams(String(body));
          return (
            params.get("grant_type") === "refresh_token" &&
            params.get("refresh_token") === "refresh-token-123"
          );
        },
      })
      .reply(200, {
        access_token: "access-token-123",
        refresh_token: "refresh-token-456",
        token_type: "bearer",
        expires_in: 3600,
        x_refresh_token_expires_in: 8726400,
      });

    const result = await exchangeRefreshToken({
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "refresh-token-123",
      dispatcher: mockAgent,
    });

    expect(result).toMatchObject({
      accessToken: "access-token-123",
      refreshToken: "refresh-token-456",
      tokenType: "bearer",
    });
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it("throws a redacted auth error on invalid credentials", async () => {
    mockAgent
      .get("https://oauth.platform.intuit.com")
      .intercept({ path: "/oauth2/v1/tokens/bearer", method: "POST" })
      .reply(401, { error: "invalid_client" });

    await expect(
      exchangeRefreshToken({
        clientId: "client-id",
        clientSecret: "super-secret-do-not-leak",
        refreshToken: "refresh-token-123",
        dispatcher: mockAgent,
      }),
    ).rejects.toThrow(QuickBooksAuthError);

    await expect(
      exchangeRefreshToken({
        clientId: "client-id",
        clientSecret: "super-secret-do-not-leak",
        refreshToken: "refresh-token-123",
        dispatcher: mockAgent,
      }),
    ).rejects.not.toThrow(/super-secret-do-not-leak/);
  });

  it("throws when the token payload is missing access_token", async () => {
    mockAgent
      .get("https://oauth.platform.intuit.com")
      .intercept({ path: "/oauth2/v1/tokens/bearer", method: "POST" })
      .reply(200, { refresh_token: "refresh-token-456" });

    await expect(
      exchangeRefreshToken({
        clientId: "client-id",
        clientSecret: "client-secret",
        refreshToken: "refresh-token-123",
        dispatcher: mockAgent,
      }),
    ).rejects.toThrow(QuickBooksAuthError);
  });
});
