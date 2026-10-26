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
});
