import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHandoffDependencyPostgresFixture } from "../../../../packages/db/src/handoff-dependency-postgres-fixture";

const isolated = vi.hoisted(() => ({ prisma: null as ReturnType<typeof createHandoffDependencyPostgresFixture>["prisma"] | null,
  telemetry: new Set<Promise<void>>() }));
vi.mock("@dpf/db", async (original) => ({
  ...await original<typeof import("@dpf/db")>(),
  get prisma() { if (!isolated.prisma) throw new Error("FIFO fixture is not ready"); return isolated.prisma; },
}));
vi.mock("@/lib/queue/queue-telemetry", async (original) => {
  const actual = await original<typeof import("@/lib/queue/queue-telemetry")>();
  return { ...actual, recordQueueTransition: (...args: Parameters<typeof actual.recordQueueTransition>) => {
    const pending = actual.recordQueueTransition(...args);
    isolated.telemetry.add(pending);
    void pending.finally(() => isolated.telemetry.delete(pending));
    return pending;
  } };
});

const configured = process.env.DATABASE_URL?.trim() ?? "";
const databaseUrl = process.env.DPF_JOBS_TEST_DATABASE_URL?.trim() || (() => {
  try { return /^\/dpf_local_ci_[01]$/.test(new URL(configured).pathname) ? configured : ""; }
  catch { return ""; }
})();
const describeDatabase = databaseUrl ? describe : describe.skip;
// Reuse the fixture's validated schema namespace; environment identity stays canonical.
const schema = `dpf_handoff_dependency_${randomUUID().replaceAll("-", "")}`;
const environmentKey = "active-candidate";
const claimPrefix = `fifo-contract:${randomUUID()}`;

describeDatabase("nonproduction lease FIFO admission — PostgreSQL", () => {
  let prisma: ReturnType<typeof createHandoffDependencyPostgresFixture>["prisma"];
  let pool: Pool;
  let claimNonprodEnvironmentLease:
    typeof import("./environment-lease").claimNonprodEnvironmentLease;
  let releaseNonprodEnvironmentLease:
    typeof import("./environment-lease").releaseNonprodEnvironmentLease;
  let listQueuedNonprodEnvironmentLeases:
    typeof import("./environment-lease").listQueuedNonprodEnvironmentLeases;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    // Structures only: no shared lease, config, task or telemetry row is copied.
    for (const table of ["NonProductionEnvironmentLease", "QueueTelemetryEvent", "PlatformConfig", "TaskRun"]) {
      await pool.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    prisma = createHandoffDependencyPostgresFixture(databaseUrl, schema).prisma;
    isolated.prisma = prisma;
    ({
      claimNonprodEnvironmentLease,
      releaseNonprodEnvironmentLease,
      listQueuedNonprodEnvironmentLeases,
    } = await import("./environment-lease"));
  });

  afterAll(async () => {
    while (isolated.telemetry.size) await Promise.all([...isolated.telemetry]);
    await prisma?.$disconnect();
    if (pool) {
      try { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
      finally { await pool.end(); }
    }
    isolated.prisma = null;
  });

  it("serializes simultaneous claimers into one owner and a stable FIFO", async () => {
    const now = new Date();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        claimNonprodEnvironmentLease({
          db: prisma,
          environmentKey,
          ownerProvider: "codex",
          ownerSessionId: `pg-session-${index}`,
          claimKey: `${claimPrefix}:${String(index).padStart(2, "0")}`,
          purpose: "PostgreSQL FIFO contract",
          url: "http://localhost:3010",
          ports: [3010],
          expiresAt: new Date(now.getTime() + 60_000),
        })),
    );

    expect(results.filter((result) => result.status === "admitted")).toHaveLength(1);
    expect(results.filter((result) => result.status === "queued")).toHaveLength(11);

    // A position returned during a simultaneous claim is an intentionally
    // point-in-time observation: later transactions can enqueue ahead of an
    // earlier response. Verify the durable post-burst ordering instead.
    const queued = (await listQueuedNonprodEnvironmentLeases({ db: prisma }))
      .filter((lease) => lease.environmentKey === environmentKey);
    const observedPositions = await Promise.all(queued.map(async (lease) => {
      const observed = await claimNonprodEnvironmentLease({
        db: prisma,
        environmentKey,
        ownerProvider: lease.ownerProvider as "codex",
        ownerSessionId: lease.ownerSessionId,
        claimKey: lease.claimKey!,
        purpose: lease.purpose,
        url: lease.url,
        ports: lease.ports,
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect(observed.status).toBe("queued");
      return observed.status === "queued" ? observed.queuePosition : 0;
    }));
    expect(observedPositions)
      .toEqual(Array.from({ length: 11 }, (_, index) => index + 1));

    const oldest = queued[0]!;
    const active = results.find((result) => result.status === "admitted")!;
    await releaseNonprodEnvironmentLease({ db: prisma, leaseId: active.lease.leaseId });
    const observed = await claimNonprodEnvironmentLease({
      db: prisma,
      environmentKey,
      ownerProvider: oldest.ownerProvider as "codex",
      ownerSessionId: oldest.ownerSessionId,
      claimKey: oldest.claimKey!,
      purpose: oldest.purpose,
      url: oldest.url,
      ports: oldest.ports,
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(observed).toMatchObject({
      status: "admitted",
      lease: { leaseId: oldest.leaseId },
      slotKey: "slot-0",
    });
  });

  it("atomically binds immediate and queued preview owners, including automatic queue promotion", async () => {
    // This Prisma client is schema-confined by createHandoffDependencyPostgresFixture.
    await prisma.nonProductionEnvironmentLease.deleteMany({});
    const { leaseCleanupConsequenceForCall } = await import("./lease-cleanup-consequence");
    const loadStance = async () => ({ environmentClass: "development", primaryPurpose: "evolve-dpf" });
    const claim = (session: string) => claimNonprodEnvironmentLease({ db: prisma, environmentKey,
      ownerProvider: "codex", ownerSessionId: session, claimKey: `${claimPrefix}:${session}`,
      purpose: "Authenticated preview transaction contract", url: "http://localhost:3010", ports: [3010],
      authenticatedUserId: "preview-user", authenticatedAgentId: "AGT-EXT-CODEX",
      expiresAt: new Date(Date.now() + 60_000) });
    const first = await claim("preview-first");
    const second = await claim("preview-second");
    expect(first.status).toBe("admitted");
    expect(second.status).toBe("queued");
    for (const result of [first, second]) {
      expect(result.lease.taskRunId).toMatch(/^TR-NONPROD-/);
      const task = await prisma.taskRun.findUniqueOrThrow({ where: { taskRunId: result.lease.taskRunId! } });
      expect(task.initiatingAgentId).toBe("AGT-EXT-CODEX");
      const call = { toolName: "release_nonprod_environment_lease", userId: "preview-user",
        context: { agentId: "AGT-EXT-CODEX" },
        params: { leaseId: result.lease.leaseId, ownerSessionId: result.lease.ownerSessionId } };
      expect(await leaseCleanupConsequenceForCall(call, { db: prisma as never, loadStance }))
        .toMatchObject({ consequence: null });
      await expect(releaseNonprodEnvironmentLease({ db: prisma, ...call.params, authenticatedUserId: "foreign",
        authenticatedAgentId: "AGT-EXT-CODEX", loadStance })).rejects.toThrow(/preview.*ownership/i);
    }
    const release = (result: typeof first) => releaseNonprodEnvironmentLease({ db: prisma,
      leaseId: result.lease.leaseId, ownerSessionId: result.lease.ownerSessionId,
      authenticatedUserId: "preview-user", authenticatedAgentId: "AGT-EXT-CODEX", loadStance });
    await release(first);
    const promoted = await prisma.nonProductionEnvironmentLease.findUniqueOrThrow({ where: { leaseId: second.lease.leaseId } });
    expect(promoted.status).toBe("active");
    const task = await prisma.taskRun.findUniqueOrThrow({ where: { taskRunId: promoted.taskRunId! } });
    expect(task.progressPayload).toMatchObject({ nonprodLeaseWait: { state: "admitted" },
      nonprodPreviewOwner: { userId: "preview-user", agentId: "AGT-EXT-CODEX" } });
    expect((await release(second)).status).toBe("released");
    expect((await release(second)).status).toBe("released");
  });

  it("rolls back preview reservation creation if the ownership Task cannot be persisted", async () => {
    await prisma.nonProductionEnvironmentLease.deleteMany({});
    const key = `${claimPrefix}:ownership-rollback`;
    const database = { nonProductionEnvironmentLease: prisma.nonProductionEnvironmentLease,
      platformConfig: prisma.platformConfig,
      $transaction: (body: (tx: unknown) => Promise<unknown>, options: unknown) => prisma.$transaction(async tx => {
        const wrapped = new Proxy(tx, { get(target, property) {
          if (property === "taskRun") return { upsert: async () => { throw new Error("ownership-store-failure"); } };
          return Reflect.get(target, property);
        } });
        return body(wrapped);
      }, options as never) };
    await expect(claimNonprodEnvironmentLease({ db: database as never, environmentKey,
      ownerProvider: "codex", ownerSessionId: "rollback-preview", claimKey: key,
      purpose: "Atomic rollback contract", url: "http://localhost:3010", ports: [3010],
      authenticatedUserId: "preview-user", authenticatedAgentId: "AGT-EXT-CODEX",
      expiresAt: new Date(Date.now() + 60_000) })).rejects.toThrow("ownership-store-failure");
    expect(await prisma.nonProductionEnvironmentLease.findUnique({ where: { claimKey: key } })).toBeNull();
  });
});
