import { describe, expect, it, vi } from "vitest";

import {
  handleIncomingOperationalPosture,
  operationalPosturePeerRef,
  type OperationalPostureExchangeDb,
} from "./operational-posture-exchange";
import { buildOperationalPostureRecord } from "./operational-posture-projection";

const identity = { installationId: `inst_${"c".repeat(32)}`, projectionSecret: "d".repeat(64) };
const now = new Date("2026-09-06T10:00:00.000Z");
const source = {
  servedVersion: "5.11.0",
  servedSha: "feedface",
  patchPosture: { critical: 1, high: 0, medium: 2, low: 0 },
  health: { status: "degraded" as const, estateItemCount: 12 },
  runtime: { targetCount: 1, healthyCount: 1 },
  capturedAt: now,
  updatedAt: now,
};
const record = buildOperationalPostureRecord({ source, identity }).record;

function db(existing: unknown, updateCount = 1) {
  const create = vi.fn().mockResolvedValue({});
  const updateMany = vi.fn().mockResolvedValue({ count: updateCount });
  const store = {
    federatedRecordMirror: { findUnique: vi.fn().mockResolvedValue(existing), create, updateMany },
  } as unknown as OperationalPostureExchangeDb;
  return { store, create, updateMany };
}

function existingRow(version: number, payloadRecord = record) {
  return {
    mirrorId: "fopm_existing",
    federationLinkId: "link_1",
    peerRecordRef: operationalPosturePeerRef(identity.installationId),
    version: BigInt(version),
    syncStatus: "synced",
    payload: { record: payloadRecord, activity: "dpf.operational-posture.reported", receivedAt: now.toISOString() },
  };
}

describe("handleIncomingOperationalPosture", () => {
  it("rejects a record that fails the contract or carries host-identifying fields", async () => {
    const { store, create } = db(null);
    const result = await handleIncomingOperationalPosture(store, "link_1", {
      ...record, hostname: "dev-node-1",
    } as typeof record);
    expect(result.action).toBe("rejected");
    expect((result as { violations: string[] }).violations).toContain("field:not-allowed:hostname");
    expect(create).not.toHaveBeenCalled();
  });

  it("persists a peer-canonical mirror keyed by the reporting install", async () => {
    const { store, create } = db(null);

    const result = await handleIncomingOperationalPosture(store, "link_1", record, { now });

    expect(result).toEqual({ action: "created", mirrorId: expect.stringMatching(/^fopm_/), originVersion: record.originVersion });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      federationLinkId: "link_1",
      recordType: "operational-posture",
      canonicalSide: "peer",
      localRecordRef: null,
      peerRecordRef: operationalPosturePeerRef(identity.installationId),
      syncStatus: "synced",
      version: record.originVersion,
    }) });
  });

  it("is a noop for a redelivery of the same version and digest", async () => {
    const { store, updateMany } = db(existingRow(record.originVersion));
    const result = await handleIncomingOperationalPosture(store, "link_1", record, { now });
    expect(result.action).toBe("noop");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("advances to a newer report with a version predicate and never overwrites a newer one", async () => {
    const later = new Date(now.getTime() + 60_000);
    const newer = buildOperationalPostureRecord({ source: { ...source, capturedAt: later, updatedAt: later }, identity }).record;

    const advance = db(existingRow(record.originVersion));
    const advanced = await handleIncomingOperationalPosture(advance.store, "link_1", newer, { now: later });
    expect(advanced.action).toBe("updated");
    expect(advance.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ version: { lt: newer.originVersion } }),
      data: expect.objectContaining({ syncStatus: "synced", version: newer.originVersion }),
    }));

    const stale = db(existingRow(newer.originVersion, newer));
    const rejected = await handleIncomingOperationalPosture(stale.store, "link_1", record, { now });
    expect(rejected).toMatchObject({ action: "conflict", reason: "origin-version-not-advancing" });
    expect(stale.updateMany).not.toHaveBeenCalled();
  });

  it("reports a concurrent-update conflict when the predicate matched nothing", async () => {
    const later = new Date(now.getTime() + 60_000);
    const newer = buildOperationalPostureRecord({ source: { ...source, capturedAt: later, updatedAt: later }, identity }).record;
    const { store } = db(existingRow(record.originVersion), 0);
    const result = await handleIncomingOperationalPosture(store, "link_1", newer, { now: later });
    expect(result).toMatchObject({ action: "conflict", reason: "concurrent-update" });
  });

  it("recovers from a create race by re-reading the row", async () => {
    const findUnique = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingRow(record.originVersion));
    const create = vi.fn().mockRejectedValue({ code: "P2002" });
    const store = {
      federatedRecordMirror: { findUnique, create, updateMany: vi.fn() },
    } as unknown as OperationalPostureExchangeDb;
    const result = await handleIncomingOperationalPosture(store, "link_1", record, { now });
    expect(result.action).toBe("noop");
  });
});
