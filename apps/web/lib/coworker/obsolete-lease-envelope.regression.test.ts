import { describe, expect, it, vi } from "vitest";
import { expireLapsedEnvelopes } from "./envelope-expiry";
import { settleObsoleteLeaseReleaseEnvelopes, type ObsoleteReleaseDb } from "./obsolete-lease-envelope";
import { OBSOLETE_NOW as now, obsoleteEnvelope, obsoleteTarget } from "./obsolete-lease-envelope.test-fixtures";

describe("obsolete release approval lifecycle", () => {
  it("retires a still-fresh exact parked request when time expiry alone cannot", async () => {
    const envelope = { ...obsoleteEnvelope(), expiresAt: new Date(now.getTime() + 60_000) };
    const db = {
      coworkerActionEnvelope: {
        findMany: vi.fn(async ({ where }: { where: { expiresAt?: unknown } }) => where.expiresAt ? [] : [envelope]),
        updateMany: vi.fn(async ({ data }: { data: object }) => { Object.assign(envelope, data); return { count: 1 }; }),
      },
      nonProductionEnvironmentLease: { findUnique: vi.fn(async () => obsoleteTarget()) },
      $executeRaw: vi.fn(async () => 1),
      $transaction: async <T,>(run: (tx: unknown) => Promise<T>): Promise<T> => run(db),
    };
    await expireLapsedEnvelopes(db, now);
    expect(envelope.status).toBe("proposed");
    const original = structuredClone(envelope.argsJson);
    await expect(settleObsoleteLeaseReleaseEnvelopes(db as unknown as ObsoleteReleaseDb, now))
      .resolves.toMatchObject({ cancelled: 1, inconclusive: 0 });
    expect(envelope.status).toBe("cancelled");
    expect(envelope.argsJson).toEqual(original);
    expect(envelope.toolExecutions).toHaveLength(1);
    expect(db.$executeRaw).toHaveBeenCalledOnce();
  });
});
