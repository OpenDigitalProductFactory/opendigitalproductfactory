import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent } from "undici";

import {
  exchangeGoogleRefreshToken,
  GoogleMarketingAuthError,
  resolveGoogleTokenEndpoint,
} from "./token-client";

describe("resolveGoogleTokenEndpoint", () => {
  const original = process.env.GOOGLE_TOKEN_ENDPOINT_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.GOOGLE_TOKEN_ENDPOINT_URL;
    } else {
      process.env.GOOGLE_TOKEN_ENDPOINT_URL = original;
    }
  });

  it("defaults to the Google OAuth token endpoint", () => {
    delete process.env.GOOGLE_TOKEN_ENDPOINT_URL;
    expect(resolveGoogleTokenEndpoint()).toBe("https://oauth2.googleapis.com/token");
  });

  it("honors an explicit token endpoint override for harness tests", () => {
    process.env.GOOGLE_TOKEN_ENDPOINT_URL = "http://integration-test-harness:8700/google/token";
    expect(resolveGoogleTokenEndpoint()).toBe("http://integration-test-harness:8700/google/token");
  });
});

describe("exchangeGoogleRefreshToken", () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
  });

  afterEach(async () => {
    await mockAgent.close();
  });

  it("exchanges a refresh token for an access token", async () => {
    mockAgent
      .get("https://oauth2.googleapis.com")
      .intercept({ path: "/token", method: "POST" })
      .reply(200, {
        access_token: "google-access-token",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly",
      });

    const result = await exchangeGoogleRefreshToken({
      clientId: "google-client-id",
      clientSecret: "google-client-secret",
      refreshToken: "google-refresh-token",
      dispatcher: mockAgent,
    });

    expect(result.accessToken).toBe("google-access-token");
    expect(result.tokenType).toBe("Bearer");
    expect(result.scope).toContain("analytics.readonly");
  });

  it("throws a redacted auth error on invalid credentials", async () => {
    mockAgent
      .get("https://oauth2.googleapis.com")
      .intercept({ path: "/token", method: "POST" })
      .reply(400, {
        error: "invalid_grant",
        error_description: "Bad Request",
      });

    await expect(
      exchangeGoogleRefreshToken({
        clientId: "google-client-id",
        clientSecret: "super-secret-google-client-secret",
        refreshToken: "google-refresh-token",
        dispatcher: mockAgent,
      }),
    ).rejects.toThrow(GoogleMarketingAuthError);

    await expect(
      exchangeGoogleRefreshToken({
        clientId: "google-client-id",
        clientSecret: "super-secret-google-client-secret",
        refreshToken: "google-refresh-token",
        dispatcher: mockAgent,
      }),
    ).rejects.not.toThrow(/super-secret-google-client-secret/);
  });
});
