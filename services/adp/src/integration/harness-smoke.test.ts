import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { adpGet } from "../lib/adp-client.js";
import { exchangeToken } from "../lib/token-client.js";

describe("adp harness smoke", () => {
  const originalApiBaseUrl = process.env.ADP_API_BASE_URL;
  const originalTokenEndpointUrl = process.env.ADP_TOKEN_ENDPOINT_URL;
  const originalSessionId = process.env.DPF_INTEGRATION_TEST_SESSION_ID;

  afterEach(() => {
    restore("ADP_API_BASE_URL", originalApiBaseUrl);
    restore("ADP_TOKEN_ENDPOINT_URL", originalTokenEndpointUrl);
    restore("DPF_INTEGRATION_TEST_SESSION_ID", originalSessionId);
  });

  it("uses the override URLs and forwards the harness session header end to end", async () => {
    let lastTokenHeader = "";
    let lastApiHeader = "";

    const server = createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/oauth/token") {
        lastTokenHeader = String(req.headers["x-dpf-harness-session"] ?? "");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ access_token: "smoke-token", expires_in: 3600 }));
        return;
      }

      if (req.method === "GET" && req.url === "/hr/v2/workers?%24top=1") {
        lastApiHeader = String(req.headers["x-dpf-harness-session"] ?? "");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ workers: [] }));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected an ephemeral TCP port");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    process.env.ADP_TOKEN_ENDPOINT_URL = `${baseUrl}/oauth/token`;
    process.env.ADP_API_BASE_URL = baseUrl;
    process.env.DPF_INTEGRATION_TEST_SESSION_ID = "smoke-run-1";

    const token = await exchangeToken({
      environment: "sandbox",
      clientId: "client-id",
      clientSecret: "client-secret",
      certPem: "cert",
      privateKeyPem: "key",
    });

    expect(token.accessToken).toBe("smoke-token");

    const workers = await adpGet<{ workers: unknown[] }>({
      credential: {
        id: "cred-1",
        environment: "sandbox",
        accessToken: token.accessToken,
        certPem: "cert",
        privateKeyPem: "key",
      },
      path: "/hr/v2/workers",
      query: { $top: 1 },
    });

    expect(workers).toEqual({ workers: [] });
    expect(lastTokenHeader).toBe("smoke-run-1");
    expect(lastApiHeader).toBe("smoke-run-1");

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
