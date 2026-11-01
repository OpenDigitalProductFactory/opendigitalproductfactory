import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createReviewPostgresFixture } from "../../test-support/review-postgres-fixture";
import { restoreOperatorProviderPause, resumeOperatorProvider, type PauseDatabase } from "./provider-operator-pause";

vi.mock("@/lib/install/instance-stance", () => ({ loadInstanceStance: async () => ({ environmentClass: "development", primaryPurpose: "evolve-dpf" }), prismaInstanceStanceStore: (db: unknown) => db }));
const configured = process.env.DATABASE_URL;
const leased = (() => { try { return process.env.DPF_NONPROD_LEASE_ID && configured && /^\/dpf_local_ci_\d+$/.test(new URL(configured).pathname) ? configured : undefined; } catch { return undefined; } })();
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL ?? leased;
const schema = `review_pause_${randomUUID().replaceAll("-", "")}`;
const tables = ["ModelProvider", "AiProviderConnection", "ScheduledJob", "AdminActivity"];
function barrier() {
  let open!: () => void;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open };
}
async function reach(signal: Promise<void>, work: Promise<unknown>) {
  await Promise.race([signal, work.then(() => { throw new Error("Operation ended before its race barrier"); })]);
}

describe.skipIf(!url)("exact pause restoration on isolated leased PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createReviewPostgresFixture>>;
  let deadline: string;
  let metadata: Record<string, string | number>;
  const send = vi.fn(async () => undefined);
  const request = { providerId: "local", expectedOperationId: "source-pause", actorId: "native-restoring-caller" };
  beforeAll(async () => { fixture = await createReviewPostgresFixture({ url: url!, schema, tables }); });
  beforeEach(async () => {
    send.mockClear();
    await fixture.pool.query('TRUNCATE "AdminActivity", "ScheduledJob", "AiProviderConnection", "ModelProvider"');
    const now = new Date(); deadline = new Date(now.getTime() + 3_600_000).toISOString();
    metadata = { kind: "operator-provider-pause", version: 1, providerId: "local", operationId: request.expectedOperationId,
      actorId: "original-operator", pausedAt: new Date(now.getTime() - 120_000).toISOString(), resumeAt: deadline,
      resumedAt: new Date(now.getTime() - 60_000).toISOString(), priorProviderStatus: "active", priorConnectionStatus: "active" };
    await fixture.db.modelProvider.create({ data: { providerId: "local", name: "Isolated local fixture", families: [], status: "active" } });
    await fixture.db.aiProviderConnection.create({ data: { providerId: "local", connectionId: "provider-default-local", status: "active", executionChannel: "local-runtime", authMethod: "local" } });
    await fixture.db.scheduledJob.create({ data: { jobId: "provider-pause-local", name: "Isolated pause fixture", enabled: true, lastStatus: "resumed", nextRunAt: null, metadata } });
  });
  afterAll(async () => { await fixture?.close(); });
  const port = (transform?: (tx: any) => any): PauseDatabase => ({
    modelProvider: fixture.db.modelProvider, aiProviderConnection: fixture.db.aiProviderConnection,
    scheduledJob: fixture.db.scheduledJob, adminActivity: fixture.db.adminActivity,
    $transaction: (run: any) => fixture.db.$transaction(tx => run(transform ? transform(tx) : tx), { timeout: 15_000 }),
  } as unknown as PauseDatabase);
  const pause = () => fixture.db.scheduledJob.findUniqueOrThrow({ where: { jobId: "provider-pause-local" } });
  const account = () => fixture.db.aiProviderConnection.findUniqueOrThrow({ where: { connectionId: "provider-default-local" } });

  it("serializes two restoration calls into one mutation, audit and timer", async () => {
    const results = await Promise.all([restoreOperatorProviderPause(request, { db: port(), send }), restoreOperatorProviderPause(request, { db: port(), send })]);
    expect(results.map(r => r.outcome).sort()).toEqual(["already-restored", "restored"]);
    expect(new Set(results.map(r => r.operationId)).size).toBe(1);
    expect(await pause()).toMatchObject({ lastStatus: "paused", nextRunAt: new Date(deadline), metadata: { restoredFromOperationId: request.expectedOperationId, resumeAt: deadline, actorId: request.actorId } });
    expect(await fixture.db.adminActivity.count()).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await account()).toMatchObject({ status: "paused" });
  });

  it.each(["new-pause", "account-disable"])("preserves %s that holds the canonical provider lock first", async change => {
    const held = barrier(), release = barrier(), attempted = barrier();
    const owner = fixture.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "ModelProvider" WHERE "providerId" = 'local' FOR UPDATE`;
      held.open(); await release.promise;
      await tx.modelProvider.update({ where: { providerId: "local" }, data: { status: "inactive" } });
      await tx.aiProviderConnection.update({ where: { connectionId: "provider-default-local" }, data: { status: change === "new-pause" ? "paused" : "inactive" } });
      if (change === "new-pause") await tx.scheduledJob.update({ where: { jobId: "provider-pause-local" }, data: { lastStatus: "paused", metadata: { ...metadata, operationId: "newer-operator-pause", actorId: "newer-operator" } } });
    }, { timeout: 15_000 });
    await reach(held.promise, owner);
    const restoration = restoreOperatorProviderPause(request, { db: port(tx => { attempted.open(); return tx; }), send });
    const observed = restoration.then(result => ({ result, error: null }), error => ({ result: null, error }));
    try {
      await reach(attempted.promise, observed); release.open(); await owner;
      expect((await observed).error).toMatchObject({ message: expect.stringMatching(/source changed/) });
      expect(await account()).toMatchObject({ status: change === "new-pause" ? "paused" : "inactive" });
      expect(await fixture.db.adminActivity.count()).toBe(0);
      expect(send).not.toHaveBeenCalled();
      if (change === "new-pause") expect((await pause()).metadata).toMatchObject({ operationId: "newer-operator-pause" });
    } finally { release.open(); await Promise.allSettled([owner, observed]); }
  });

  it("rolls back routing and timer writes if the real audit insert is rejected", async () => {
    await fixture.pool.query(`ALTER TABLE "AdminActivity" ADD CONSTRAINT "reject_fixture_actor" CHECK ("userId" <> 'reject-fixture-actor')`);
    try {
      await expect(restoreOperatorProviderPause({ ...request, actorId: "reject-fixture-actor" }, { db: port(), send })).rejects.toThrow();
      expect(await account()).toMatchObject({ status: "active" });
      expect(await pause()).toMatchObject({ lastStatus: "resumed", nextRunAt: null, metadata });
      expect(await fixture.db.adminActivity.count()).toBe(0);
      expect(send).not.toHaveBeenCalled();
    } finally { await fixture.pool.query('ALTER TABLE "AdminActivity" DROP CONSTRAINT "reject_fixture_actor"'); }
  });

  it("retains the exact durable expiry after event failure and rejects the old timer", async () => {
    send.mockRejectedValueOnce(new Error("isolated event failure"));
    const restored = await restoreOperatorProviderPause(request, { db: port(), send });
    expect(restored).toMatchObject({ outcome: "restored", deliveryPending: true, resumeAt: deadline });
    expect((await pause()).nextRunAt).toEqual(new Date(deadline));
    expect(await resumeOperatorProvider({ providerId: "local", operationId: request.expectedOperationId, automatic: true }, { db: port(), now: new Date(Date.parse(deadline) + 1) })).toMatchObject({ outcome: "superseded" });
    expect((await pause()).metadata).toMatchObject({ operationId: restored.operationId });
    expect((await account()).status).toBe("paused");
  });
});
