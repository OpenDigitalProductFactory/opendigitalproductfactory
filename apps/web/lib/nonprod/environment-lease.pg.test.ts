import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const environmentKey = `fifo-contract-${randomUUID()}`;
const claimPrefix = `fifo-contract:${randomUUID()}`;

describeDatabase("nonproduction lease FIFO admission — PostgreSQL", () => {
  let prisma: typeof import("@dpf/db").prisma;
  let claimNonprodEnvironmentLease:
    typeof import("./environment-lease").claimNonprodEnvironmentLease;
  let releaseNonprodEnvironmentLease:
    typeof import("./environment-lease").releaseNonprodEnvironmentLease;
  let listQueuedNonprodEnvironmentLeases:
    typeof import("./environment-lease").listQueuedNonprodEnvironmentLeases;

  beforeAll(async () => {
    ({ prisma } = await import("@dpf/db"));
    ({
      claimNonprodEnvironmentLease,
      releaseNonprodEnvironmentLease,
      listQueuedNonprodEnvironmentLeases,
    } = await import("./environment-lease"));
  });

  afterAll(async () => {
    if (!prisma) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
    const rows = await prisma.nonProductionEnvironmentLease.findMany({
      where: { environmentKey },
      select: { leaseId: true },
    });
    await prisma.nonProductionEnvironmentLease.deleteMany({
      where: { environmentKey },
    });
    await prisma.queueTelemetryEvent.deleteMany({
      where: {
        queueKey: `compute:nonprod-${environmentKey}`,
        itemId: { in: rows.map((row) => row.leaseId) },
      },
    });
  });

  it("serializes simultaneous claimers into one owner and a stable FIFO", async () => {
    const now = new Date();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        claimNonprodEnvironmentLease({
          environmentKey: environmentKey as never,
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
    const queued = (await listQueuedNonprodEnvironmentLeases({}))
      .filter((lease) => lease.environmentKey === environmentKey);
    const observedPositions = await Promise.all(queued.map(async (lease) => {
      const observed = await claimNonprodEnvironmentLease({
        environmentKey: environmentKey as never,
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
    await releaseNonprodEnvironmentLease({ leaseId: active.lease.leaseId });
    const observed = await claimNonprodEnvironmentLease({
      environmentKey: environmentKey as never,
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
