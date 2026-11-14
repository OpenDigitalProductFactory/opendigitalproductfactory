import { expect, it, vi } from "vitest";
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/queue/queue-telemetry", () => ({ recordQueueTransition: vi.fn() }));
import { renewNonprodEnvironmentLease, reapExpiredNonprodEnvironmentLeases } from "./environment-lease";
import { admitted, db, NOW } from "./__tests__/environment-lease-fixtures";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  let row = admitted({
    claimKey: "dev-portal:race", admittedAt: new Date(NOW.getTime() - 25 * 60_000),
    expiresAt: new Date(NOW.getTime() + 30_000),
  });
  const database = db();
  let lockTail = Promise.resolve();
  database.$transaction.mockImplementation(async (body: (tx: unknown) => Promise<unknown>) => {
    let release: (() => void) | undefined;
    const tx = { ...database, $executeRaw: async () => {
      if (!release) {
        const prior = lockTail;
        const held = deferred(); lockTail = prior.then(() => held.promise);
        await prior; release = held.resolve;
      }
      return 1;
    } };
    try { return await body(tx); } finally { release?.(); }
  });
  database.nonProductionEnvironmentLease.findUnique.mockImplementation(async () => structuredClone(row));
  database.nonProductionEnvironmentLease.findMany.mockImplementation(async (args: {
    where: { status?: string | { in: string[] }; expiresAt?: { lt: Date }; id?: { in: string[] } };
  }) => {
    if (args.where.status === "queued") return [];
    if (args.where.expiresAt?.lt) {
      return ["active", "queued"].includes(row.status)
        && row.expiresAt < args.where.expiresAt.lt ? [structuredClone(row)] : [];
    }
    return [structuredClone(row)];
  });
  database.nonProductionEnvironmentLease.update.mockImplementation(async (args: { data: Record<string, unknown> }) => {
    row = { ...row, ...args.data }; return structuredClone(row);
  });
  database.nonProductionEnvironmentLease.updateMany.mockImplementation(async (args: {
    where: { id?: { in: string[] } }; data: Record<string, unknown>;
  }) => {
    if (args.where.id && !args.where.id.in.includes(row.id)) return { count: 0 };
    row = { ...row, ...args.data }; return { count: 1 };
  });
  return { database, current: () => structuredClone(row) };
}

it("a renewal paused after its old active read cannot mutate or acknowledge a committed expiry", async () => {
  const f = fixture(), captured = deferred(), continueRead = deferred();
  f.database.nonProductionEnvironmentLease.findUnique.mockImplementationOnce(async () => {
    const old = f.current(); captured.resolve(); await continueRead.promise; return old;
  });
  const renewal = renewNonprodEnvironmentLease({ db: f.database as never,
    leaseId: "NPEL-1", ownerSessionId: "session-1", ttlMs: 120_000, now: NOW });
  await captured.promise;
  await reapExpiredNonprodEnvironmentLeases({ db: f.database as never, now: new Date(NOW.getTime() + 60_000) });
  const expired = f.current(); expect(expired.status).toBe("expired");
  continueRead.resolve();
  expect(await renewal).toMatchObject({ status: "lost", reason: "not-active" });
  expect(f.current()).toEqual(expired);
});

it("renewal winning the shared lock keeps a stale expiry observation from ending the healthy lease", async () => {
  const f = fixture(), atWrite = deferred(), continueWrite = deferred();
  const write = f.database.nonProductionEnvironmentLease.update.getMockImplementation()!;
  f.database.nonProductionEnvironmentLease.update.mockImplementationOnce(async (args: { data: Record<string, unknown> }) => {
    atWrite.resolve(); await continueWrite.promise; return write(args);
  });
  const renewal = renewNonprodEnvironmentLease({ db: f.database as never,
    leaseId: "NPEL-1", ownerSessionId: "session-1", ttlMs: 120_000, now: NOW });
  await atWrite.promise;
  const expiry = reapExpiredNonprodEnvironmentLeases({ db: f.database as never, now: new Date(NOW.getTime() + 60_000) });
  // Allow expiry's pre-lock query to observe the old deadline, then commit the
  // renewal. The production lock must make expiry re-evaluate that snapshot.
  await new Promise(resolve => setImmediate(resolve));
  continueWrite.resolve();
  expect(await renewal).toMatchObject({ status: "renewed" });
  await expiry;
  expect(f.current()).toMatchObject({ status: "active", activeKey: "local-integration-ci:slot-0", releasedAt: null });
  expect(f.current().expiresAt).toEqual(new Date(NOW.getTime() + 120_000));
});
