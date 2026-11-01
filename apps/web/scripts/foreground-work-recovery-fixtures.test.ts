import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { assertForegroundFixtureRuntime, assertForegroundBackgroundQuiet, prepareForegroundFixtures,
  cleanupForegroundFixtures, foregroundIsolationFailure, foregroundSeedScheduleDefinitions, prepareForegroundTarget,
  hasSuccessfulForegroundReconciliation, waitForForegroundDelivery, startForegroundFixtureTransport } from "./foreground-work-recovery-fixtures";

const admitted = {
  CI: "true", GITHUB_ACTIONS: "true", DPF_FOREGROUND_RECOVERY_SCENARIO_CI: "1",
  GITHUB_SHA: "a".repeat(40), GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1",
  DATABASE_URL: "postgresql://dpf:ci_test_password@localhost:5432/dpf",
  UX_SWEEP_BASE_URL: "http://localhost:3000",
};
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
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
      userFact: { findMany: async () => [] },
      workroomParticipant: { findMany: async () => [] },
      $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
    };
    await expect(prepareForegroundFixtures(db as unknown as Parameters<typeof prepareForegroundFixtures>[0], "http://127.0.0.1:40000"))
      .rejects.toThrow(/Foreground fixture refuses/);
    expect(write).not.toHaveBeenCalled();
  });
});

function quietScope(facts: Array<{ value: string }> = [], claims: unknown[] = []) {
  return { scheduledAgentTask: { count: async () => 0 }, taskRun: { count: async () => 0 },
    userFact: { findMany: async () => facts },
    workroomParticipant: { findMany: async () => claims.map(scopeClaims => ({ workroom: { scopeClaims } })) } };
}
describe("latent background work cannot enter the foreground fixture", () => {
  it.each(["assertive", "balanced"])("refuses a %s fact even with no scheduled task", async level => {
    enable();
    const db = quietScope([{ value: JSON.stringify({ level }) }]);
    await expect(assertForegroundBackgroundQuiet(db as unknown as Parameters<typeof assertForegroundBackgroundQuiet>[0])).rejects.toThrow("latent proactive work");
  });
  it("refuses an active room cadence and unreadable legacy intent", async () => {
    enable();
    const db = quietScope([], [[{ workroomPosture: { proactivityLevel: "balanced" } }]]);
    await expect(assertForegroundBackgroundQuiet(db as unknown as Parameters<typeof assertForegroundBackgroundQuiet>[0])).rejects.toThrow("live room cadences");
    const broken = quietScope([{ value: "not-json" }]);
    await expect(assertForegroundBackgroundQuiet(broken as unknown as Parameters<typeof assertForegroundBackgroundQuiet>[0])).rejects.toThrow("unreadable proactivity");
  });
  it("allows quiet intent without writing any preference or scheduling a task", async () => {
    enable();
    const db = quietScope([{ value: '{"level":"quiet"}' }], [[{ workroomPosture: { proactivityLevel: "quiet" } }]]);
    await expect(assertForegroundBackgroundQuiet(db as unknown as Parameters<typeof assertForegroundBackgroundQuiet>[0])).resolves.toBeUndefined();
  });
});

it("does not call a delayed duplicate settled until fanout and the actual queue run complete", async () => {
  enable(); vi.useFakeTimers();
  let fannedOut = false, status = "queued", finished = false;
  const db = { jobEvent: { findMany: async () => [{ id: "new-delivery", fannedOutAt: fannedOut ? new Date() : null }] },
    jobRun: { findMany: async () => [{ id: "run", eventId: "new-delivery", status, output: { kind: "responded" } }] } };
  const waiting = waitForForegroundDelivery(db as unknown as Parameters<typeof waitForForegroundDelivery>[0],
    { taskRunId: "fixture", beforeEventIds: ["older-delivery"], intervalMs: 10, timeoutMs: 1000 }).then(value => { finished = true; return value; });
  try {
    await vi.advanceTimersByTimeAsync(100);
    expect(finished).toBe(false);
    fannedOut = true; status = "running";
    await vi.advanceTimersByTimeAsync(100);
    expect(finished).toBe(false);
    status = "completed";
    await vi.advanceTimersByTimeAsync(10);
    expect((await waiting).eventIds).toEqual(["new-delivery"]);
  } finally { fannedOut = true; status = "completed"; await vi.advanceTimersByTimeAsync(20); await waiting; }
});

describe("unsettled work preserves the provider fixture", () => {
  it.each(["client", "request", "queue"])("performs no cleanup write when %s is unsettled", async boundary => {
    enable();
    const transaction = vi.fn();
    const db = { ...quietScope(),
      taskRun: { count: async ({ where }: { where: { taskRunId: { in?: string[] } } }) => where.taskRunId.in && boundary === "request" ? 1 : 0 },
      jobRun: { count: async () => boundary === "queue" ? 1 : 0 }, jobEvent: { count: async () => 0 }, $transaction: transaction };
    await expect(cleanupForegroundFixtures(db as unknown as Parameters<typeof cleanupForegroundFixtures>[0],
      {} as Parameters<typeof cleanupForegroundFixtures>[1], { taskRunIds: ["owned"], clientSubmissionsSettled: boundary !== "client" })).rejects.toThrow(/preserve/i);
    expect(transaction).not.toHaveBeenCalled();
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


it("requires a successful recurring reconciliation that inspected retained work", () => {
  expect(hasSuccessfulForegroundReconciliation([{ steps: [{ output: { inspected: 1 } }] }])).toBe(true);
  expect(hasSuccessfulForegroundReconciliation([{ steps: [{ output: { outcome: "unavailable" } }] }])).toBe(false);
  expect(hasSuccessfulForegroundReconciliation([{ steps: [{ output: { inspected: 0 } }] }])).toBe(false);
  expect(hasSuccessfulForegroundReconciliation([{ steps: [] }])).toBe(false);
});


it("reports isolation failures without leaking exception content or connection details", () => {
  expect(foregroundIsolationFailure(new Error("Foreground fixture refuses latent proactive work")))
    .toEqual({ reason: "latent-proactive-work" });
  expect(foregroundIsolationFailure(Object.assign(new Error("postgresql://private-fixture-host/private-data"), { code: "P2021" })))
    .toEqual({ reason: "unexpected-isolation-error", databaseCode: "P2021" });
  expect(foregroundIsolationFailure(new Error("private-fixture-exception-content")))
    .toEqual({ reason: "unexpected-isolation-error" });
  expect(foregroundIsolationFailure(new Error("constructor")))
    .toEqual({ reason: "unexpected-isolation-error" });
});

it("checks isolation early and again immediately before normal boot", () => {
  const workflow = parse(readFileSync(new URL("../../../.github/workflows/ux-route-sweep.yml", import.meta.url), "utf8"));
  const steps = workflow.jobs.sweep.steps as Array<{ name: string; run?: string }>;
  const checks = steps.flatMap((step, index) => step.run?.includes("foreground-work-recovery-fixtures.ts --check-target") ? [index] : []);
  expect(checks.length).toBeGreaterThanOrEqual(2);
  expect(checks[0]).toBeLessThan(steps.findIndex(step => step.name === "Build the portal"));
  expect(checks.at(-1)).toBe(steps.findIndex(step => step.name === "Start the portal") - 1);
});

it("refuses work introduced after the initial isolation check", async () => {
  enable();
  const db = { scheduledAgentTask: { count: vi.fn().mockResolvedValue(0) }, taskRun: { count: vi.fn().mockResolvedValue(0) },
    userFact: { findMany: vi.fn().mockResolvedValue([]) }, workroomParticipant: { findMany: vi.fn().mockResolvedValue([]) } };
  await assertForegroundBackgroundQuiet(db as never);
  db.taskRun.count.mockResolvedValue(1);
  await expect(assertForegroundBackgroundQuiet(db as never)).rejects.toThrow("unrelated runnable tasks");
});

describe("disposable CI seed schedules", () => {
  async function target() {
    enable();
    const definitions = await foregroundSeedScheduleDefinitions("fixture-owner");
    let active = true;
    const row = { ...definitions[0], id: "fixture-seed-row", isActive: true, updatedAt: new Date(),
      lastRunAt: null, lastStatus: null, lastError: null, lastThreadId: null, taskRunId: null, attempts: 0 };
    const tx = { scheduledAgentTask: { findMany: vi.fn(async () => active ? [row] : []), count: vi.fn(async () => Number(active)),
      updateMany: vi.fn(async () => { active = false; return { count: 1 }; }) },
      taskRun: { count: vi.fn().mockResolvedValue(0) }, jobRun: { count: vi.fn().mockResolvedValue(0) },
      jobEvent: { count: vi.fn().mockResolvedValue(0) }, credentialEntry: { count: vi.fn().mockResolvedValue(0) },
      userFact: { findMany: vi.fn().mockResolvedValue([]) }, workroomParticipant: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findFirst: vi.fn().mockResolvedValue({ id: "fixture-owner" }) }, portfolio: { findUnique: vi.fn().mockResolvedValue(null) },
      organization: { findFirst: vi.fn().mockResolvedValue(null) }, principalAlias: { findFirst: vi.fn().mockResolvedValue(null) } };
    return { row, tx, db: { $transaction: vi.fn(async (fn: (value: unknown) => unknown) => fn(tx)) } };
  }
  it("suspends only untouched canonical seed configuration and retains its original activation", async () => {
    const { db, row, tx } = await target();
    expect(await prepareForegroundTarget(db as never)).toEqual([{ id: row.id, taskId: row.taskId, isActive: true }]);
    expect(tx.scheduledAgentTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: row.id, taskId: row.taskId, updatedAt: row.updatedAt, isActive: true }), data: { isActive: false },
    }));
  });
  it.each(["unknown", "modified", "owner", "history", "run", "event", "credential"])("refuses %s state before any suspension", async kind => {
    const { db, row, tx } = await target();
    if (kind === "unknown") row.taskId = "unrelated-fixture-task";
    if (kind === "modified") row.prompt += " modified";
    if (kind === "owner") row.ownerUserId = "another-fixture-owner";
    if (kind === "history") row.attempts = 1;
    if (kind === "run") tx.taskRun.count.mockResolvedValue(1);
    if (kind === "event") tx.jobEvent.count.mockResolvedValue(1);
    if (kind === "credential") tx.credentialEntry.count.mockResolvedValue(1);
    await expect(prepareForegroundTarget(db as never)).rejects.toThrow();
    expect(tx.scheduledAgentTask.updateMany).not.toHaveBeenCalled();
  });
});
