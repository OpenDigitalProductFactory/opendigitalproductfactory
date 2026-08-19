import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent } from "undici";

import {
  exchangeMicrosoftGraphClientCredentials,
  Microsoft365CommunicationsAuthError,
  resolveMicrosoftTokenEndpoint,
} from "./token-client";

describe("resolveMicrosoftTokenEndpoint", () => {
  const original = process.env.MICROSOFT365_TOKEN_ENDPOINT_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.MICROSOFT365_TOKEN_ENDPOINT_URL;
    } else {
      process.env.MICROSOFT365_TOKEN_ENDPOINT_URL = original;
    }
  });

  it("uses the tenant-scoped Microsoft token endpoint by default", () => {
    delete process.env.MICROSOFT365_TOKEN_ENDPOINT_URL;
    expect(resolveMicrosoftTokenEndpoint("tenant-123")).toBe(
      "https://login.microsoftonline.com/tenant-123/oauth2/v2.0/token",
    );
  });

  it("honors an explicit token endpoint override for harness tests", () => {
    process.env.MICROSOFT365_TOKEN_ENDPOINT_URL =
      "http://integration-test-harness:8700/microsoft/token";
    expect(resolveMicrosoftTokenEndpoint("tenant-123")).toBe(
      "http://integration-test-harness:8700/microsoft/token",
    );
  });
});

describe("exchangeMicrosoftGraphClientCredentials", () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
  });

  afterEach(async () => {
    await mockAgent.close();
  });

  it("posts client_credentials and returns a Graph access token", async () => {
    mockAgent
      .get("https://login.microsoftonline.com")
      .intercept({
        path: "/tenant-123/oauth2/v2.0/token",
        method: "POST",
        body: (body) => {
          const params = new URLSearchParams(String(body));
          return (
            params.get("grant_type") === "client_credentials" &&
            params.get("client_id") === "client-id" &&
            params.get("client_secret") === "client-secret" &&
            params.get("scope") === "https://graph.microsoft.com/.default"
          );
        },
      })
      .reply(200, {
        access_token: "graph-token-123",
        token_type: "Bearer",
        expires_in: 3600,
      });

    const result = await exchangeMicrosoftGraphClientCredentials({
      tenantId: "tenant-123",
      clientId: "client-id",
      clientSecret: "client-secret",
      dispatcher: mockAgent,
    });

    expect(result).toMatchObject({
      accessToken: "graph-token-123",
      tokenType: "Bearer",
    });
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it("throws a redacted auth error on invalid credentials", async () => {
    mockAgent
      .get("https://login.microsoftonline.com")
      .intercept({
        path: "/tenant-123/oauth2/v2.0/token",
        method: "POST",
      })
      .reply(401, { error: "invalid_client" });

    const result = exchangeMicrosoftGraphClientCredentials({
      tenantId: "tenant-123",
      clientId: "client-id",
      clientSecret: "super-secret-do-not-leak",
      dispatcher: mockAgent,
    });

    await expect(result).rejects.toThrow(Microsoft365CommunicationsAuthError);
    await expect(result).rejects.not.toThrow(/super-secret-do-not-leak/);
  });

  it("throws when the token payload is missing access_token", async () => {
    mockAgent
      .get("https://login.microsoftonline.com")
      .intercept({
        path: "/tenant-123/oauth2/v2.0/token",
        method: "POST",
      })
      .reply(200, { token_type: "Bearer" });

    await expect(
      exchangeMicrosoftGraphClientCredentials({
        tenantId: "tenant-123",
        clientId: "client-id",
        clientSecret: "client-secret",
        dispatcher: mockAgent,
      }),
    ).rejects.toThrow(Microsoft365CommunicationsAuthError);
  });
});
