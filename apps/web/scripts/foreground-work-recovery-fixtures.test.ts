import { afterEach, describe, expect, it, vi } from "vitest";
import { assertForegroundFixtureRuntime, prepareForegroundFixtures, startForegroundFixtureTransport } from "./foreground-work-recovery-fixtures";

const admitted = {
  CI: "true", GITHUB_ACTIONS: "true", DPF_FOREGROUND_RECOVERY_SCENARIO_CI: "1",
  GITHUB_SHA: "a".repeat(40), GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1",
  DATABASE_URL: "postgresql://dpf:ci_test_password@localhost:5432/dpf",
  UX_SWEEP_BASE_URL: "http://localhost:3000",
};
afterEach(() => vi.unstubAllEnvs());
const enable = () => { for (const [key, value] of Object.entries(admitted)) vi.stubEnv(key, value); };

describe("foreground workflow fixture target", () => {
  it("admits only the explicitly selected isolated CI target", () => {
    expect(assertForegroundFixtureRuntime(admitted)).toEqual({
      sourceSha: admitted.GITHUB_SHA, origin: "http://localhost:3000", runKey: "foreground-recovery-123-1",
    });
  });
  it.each([
    { CI: "false" }, { GITHUB_ACTIONS: "false" }, { DPF_FOREGROUND_RECOVERY_SCENARIO_CI: "0" },
    { GITHUB_SHA: "main" }, { GITHUB_RUN_ID: "not-a-run" },
    { DATABASE_URL: "postgresql://dpf:ci_test_password@localhost:5432/production" },
    { DATABASE_URL: "postgresql://dpf:ci_test_password@remote:5432/dpf" },
    { DATABASE_URL: "postgresql://dpf:another-password@localhost:5432/dpf" },
    { DATABASE_URL: "postgresql://dpf:ci_test_password@localhost:5432/dpf?schema=public" },
    { UX_SWEEP_BASE_URL: "https://localhost" }, { UX_SWEEP_BASE_URL: "http://localhost:3001" },
    { UX_SWEEP_BASE_URL: "http://localhost:3000/workspace" },
  ])("refuses a non-admitted boundary before any fixture write: %j", patch => {
    expect(() => assertForegroundFixtureRuntime({ ...admitted, ...patch })).toThrow();
  });
});

describe("foreground fixture does not replace existing authority or provider state", () => {
  it.each(["provider", "credential", "health", "scheduled-task", "retained-request"])("refuses existing %s state before any write", async collision => {
    enable();
    const write = vi.fn(async () => ({}));
    const db = {
      modelProvider: { findUniqueOrThrow: async () => ({ status: collision === "provider" ? "active" : "unconfigured" }), update: write },
      aiProviderConnection: { findUniqueOrThrow: async () => ({ id: "account", status: "unconfigured" }), update: write },
      credentialEntry: { count: async () => collision === "credential" ? 1 : 0, create: write },
      modelProfile: { count: async () => 0, findMany: async () => [], updateMany: write, create: write },
      providerCapacityStatus: { count: async () => collision === "health" ? 1 : 0 },
      scheduledAgentTask: { count: async () => collision === "scheduled-task" ? 1 : 0 },
      taskRun: { count: async () => collision === "retained-request" ? 1 : 0 },
      $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
    };
    await expect(prepareForegroundFixtures(db as unknown as Parameters<typeof prepareForegroundFixtures>[0], "http://127.0.0.1:40000"))
      .rejects.toThrow("refuses configured credentials");
    expect(write).not.toHaveBeenCalled();
  });
});

it("the loopback provider refuses unrelated requests and exposes a real temporary failure before recovery", async () => {
  enable();
  const transport = await startForegroundFixtureTransport({ modelId: "fixture-model", marker: "fixture-request", answer: "fixture-result" });
  const send = (model: string, content: string, stream = false) => fetch(transport.baseUrl + "/v1/chat/completions", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer synthetic-foreground-api-key" },
    body: JSON.stringify({ model, messages: [{ role: "user", content }], stream }),
  });
  try {
    expect((await send("another-model", "fixture-request")).status).toBe(400);
    expect((await send("fixture-model", "unrelated request")).status).toBe(400);
    const unauthenticated = await fetch(transport.baseUrl + "/v1/chat/completions", { method: "POST",
      body: JSON.stringify({ model: "fixture-model", messages: [{ role: "user", content: "fixture-request" }] }) });
    expect(unauthenticated.status).toBe(400);
    expect((await send("fixture-model", "fixture-request")).status).toBe(429);
    transport.recover();
    const recovered = await send("fixture-model", "fixture-request");
    expect(recovered.status).toBe(200);
    expect((await recovered.json()).choices[0].message.content).toBe("fixture-result");
    const streamed = await send("fixture-model", "fixture-request", true);
    expect(await streamed.text()).toContain('"content":"fixture-result"');
    expect(transport.counts()).toEqual({ requests: 3, rejected: 3 });
  } finally { await transport.close(); }
});
