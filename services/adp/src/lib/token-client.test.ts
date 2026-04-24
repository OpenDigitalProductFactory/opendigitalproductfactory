import { afterEach, describe, expect, it } from "vitest";
import { MockAgent, setGlobalDispatcher } from "undici";

import { exchangeToken } from "./token-client.js";

describe("token-client", () => {
  const originalTokenEndpointUrl = process.env.ADP_TOKEN_ENDPOINT_URL;
  const originalSessionId = process.env.DPF_INTEGRATION_TEST_SESSION_ID;

  afterEach(async () => {
    restore("ADP_TOKEN_ENDPOINT_URL", originalTokenEndpointUrl);
    restore("DPF_INTEGRATION_TEST_SESSION_ID", originalSessionId);
  });

  it("uses the override token endpoint and forwards the harness session header", async () => {
    process.env.ADP_TOKEN_ENDPOINT_URL = "http://adp-harness.test/oauth/token";
    process.env.DPF_INTEGRATION_TEST_SESSION_ID = "session-123";

    const mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);

    const pool = mockAgent.get("http://adp-harness.test");
    pool
      .intercept({
        path: "/oauth/token",
        method: "POST",
        headers: {
          "x-dpf-harness-session": "session-123",
        },
      })
      .reply(200, {
        access_token: "token-123",
        expires_in: 3600,
      });

    const result = await exchangeToken({
      environment: "sandbox",
      clientId: "client-id",
      clientSecret: "client-secret",
      certPem: "cert",
      privateKeyPem: "key",
    });

    expect(result.accessToken).toBe("token-123");
    await mockAgent.close();
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
