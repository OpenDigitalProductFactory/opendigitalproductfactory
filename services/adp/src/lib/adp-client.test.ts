import { afterEach, describe, expect, it } from "vitest";
import { MockAgent, setGlobalDispatcher } from "undici";

import { adpGet } from "./adp-client.js";

describe("adp-client", () => {
  const originalApiBaseUrl = process.env.ADP_API_BASE_URL;
  const originalSessionId = process.env.DPF_INTEGRATION_TEST_SESSION_ID;

  afterEach(async () => {
    restore("ADP_API_BASE_URL", originalApiBaseUrl);
    restore("DPF_INTEGRATION_TEST_SESSION_ID", originalSessionId);
  });

  it("uses the override API base URL and forwards the harness session header", async () => {
    process.env.ADP_API_BASE_URL = "http://adp-harness.test";
    process.env.DPF_INTEGRATION_TEST_SESSION_ID = "session-xyz";

    const mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);

    const pool = mockAgent.get("http://adp-harness.test");
    pool
      .intercept({
        path: "/hr/v2/workers?$top=1",
        method: "GET",
        headers: {
          authorization: "Bearer token-abc",
          "x-dpf-harness-session": "session-xyz",
        },
      })
      .reply(200, { workers: [] });

    const result = await adpGet<{ workers: unknown[] }>({
      credential: {
        id: "cred-1",
        environment: "sandbox",
        accessToken: "token-abc",
        certPem: "cert",
        privateKeyPem: "key",
      },
      path: "/hr/v2/workers",
      query: { $top: 1 },
    });

    expect(result).toEqual({ workers: [] });
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
