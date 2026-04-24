import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";

import { createScenarioStateStore } from "./session-state.js";
import { createHarnessServer } from "./harness.js";

describe("harness vendor routing", () => {
  const servers: Array<ReturnType<typeof createHarnessServer> extends Promise<infer T> ? T : never> = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop();
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("serves the default happy-path worker fixture", async () => {
    const state = createScenarioStateStore();
    const server = await createHarnessServer({
      isTestMode: true,
      controlToken: "test-token",
      state,
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected TCP address");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/hr/v2/workers`, {
      headers: {
        "X-DPF-Harness-Session": "run-1",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      workers: [
        {
          associateOID: "G3QZ9WB3KH1234567",
        },
      ],
    });
  });

  it("uses session-scoped scenario overrides for vendor routes", async () => {
    const state = createScenarioStateStore();
    state.setScenario("adp", "run-2", "rate-limited");

    const server = await createHarnessServer({
      isTestMode: true,
      controlToken: "test-token",
      state,
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected TCP address");
    }

    const response = await fetch(
      `http://127.0.0.1:${address.port}/payroll/v1/workers/EMP0042/pay-statements`,
      {
        headers: {
          "X-DPF-Harness-Session": "run-2",
        },
      },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    await expect(response.json()).resolves.toEqual({ error: "rate_limited" });
  });

  it("returns malformed payloads for adversarial fixture scenarios", async () => {
    const state = createScenarioStateStore();
    state.setScenario("adp", "run-3", "malformed-response");

    const server = await createHarnessServer({
      isTestMode: true,
      controlToken: "test-token",
      state,
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected TCP address");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-DPF-Harness-Session": "run-3",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: "client-id",
        client_secret: "client-secret",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("{\"access_token\":");
  });

  it("rejects invalid query parameters before serving a scenario response", async () => {
    const state = createScenarioStateStore();

    const server = await createHarnessServer({
      isTestMode: true,
      controlToken: "test-token",
      state,
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected TCP address");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/hr/v2/workers?$top=not-a-number`, {
      headers: {
        "X-DPF-Harness-Session": "run-invalid-query",
      },
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: "Contract validation failed",
    });
  });
});
