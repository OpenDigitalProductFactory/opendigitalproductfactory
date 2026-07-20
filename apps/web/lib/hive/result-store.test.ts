import { describe, expect, it, vi } from "vitest";

import { deliverHiveResult, persistHiveResult, type HiveResultStore } from "./result-store";

const bundle = {
  schemaVersion: "dpf.hive-result/1",
  result: { commit: "abc123" },
  evidence: { tests: "passed" },
  provenance: { contributor: "partner-pseudonym" },
  attribution: { mode: "pseudonymous" },
  review: { requested: true },
  disposition: { recommendation: "review" },
  sourceReceipt: "receipt_opaque_123",
};

describe("Hive result durability", () => {
  it("commits intake without invoking a forge and is idempotent by opaque receipt", async () => {
    let stored: Record<string, unknown> | null = null;
    const db = {
      hiveContributionLedger: {
        findUnique: vi.fn(async () => stored as never),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          stored = { id: "ledger_1", ...data };
          return stored as never;
        }),
        update: vi.fn(),
      },
    } as unknown as HiveResultStore;

    await expect(persistHiveResult(bundle, db)).resolves.toEqual({ ok: true, action: "created", id: "ledger_1" });
    await expect(persistHiveResult(bundle, db)).resolves.toEqual({ ok: true, action: "noop", id: "ledger_1" });
    expect(db.hiveContributionLedger.create).toHaveBeenCalledTimes(1);
  });

  it("retains the accepted ledger row when forge delivery fails and records retry state", async () => {
    const update = vi.fn(async () => ({ id: "ledger_1", payloadHash: "hash" }));
    const db = {
      hiveContributionLedger: {
        findUnique: vi.fn(async () => ({
          id: "ledger_1",
          payloadHash: "hash",
          status: "accepted",
          deliveryAttempts: 0,
          resultBundle: bundle,
        })),
        create: vi.fn(),
        update,
      },
    } as unknown as HiveResultStore;

    const result = await deliverHiveResult("ledger_1", async () => ({ ok: false, error: "forge unavailable" }), db);
    expect(result).toMatchObject({ status: "retry", attempts: 1, lastError: "forge unavailable" });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "ledger_1" },
      data: expect.objectContaining({ deliveryStatus: "retry", deliveryAttempts: 1 }),
    }));
  });

  it("does not redeliver a result that already has a durable remote receipt", async () => {
    const delivery = vi.fn();
    const update = vi.fn();
    const db = {
      hiveContributionLedger: {
        findUnique: vi.fn(async () => ({
          id: "ledger_1",
          payloadHash: "hash",
          status: "accepted",
          deliveryStatus: "delivered",
          deliveryAttempts: 1,
          deliveryRemoteRef: "https://github.test/issues/1",
          resultBundle: bundle,
        })),
        create: vi.fn(),
        update,
      },
    } as unknown as HiveResultStore;

    await expect(deliverHiveResult("ledger_1", delivery, db)).resolves.toMatchObject({
      status: "delivered",
      attempts: 1,
      remoteRef: "https://github.test/issues/1",
    });
    expect(delivery).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
