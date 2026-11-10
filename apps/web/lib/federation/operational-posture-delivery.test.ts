import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queue/queue-telemetry", () => ({ recordQueueTransition: vi.fn().mockResolvedValue(undefined) }));

import { dispatchDueDemand, type DemandDeliveryDb } from "./demand-delivery";
import {
  OPERATIONAL_POSTURE_HEARTBEAT_MS,
  decodeOperationalPostureOutboxPayload,
  operationalPostureContentDigest,
  operationalPostureLocalRef,
  queueOperationalPostureProjection,
} from "./operational-posture-delivery";
import { buildOperationalPostureRecord } from "./operational-posture-projection";

const identity = { installationId: `inst_${"a".repeat(32)}`, projectionSecret: "b".repeat(64) };
const link = { linkId: "link_1", peerAuthorityUrl: "https://peer.example", peerTokenEnc: "encrypted" };
const now = new Date("2026-09-06T10:00:00.000Z");
const source = {
  servedVersion: "5.12.0",
  servedSha: "abc123",
  patchPosture: { critical: 0, high: 2, medium: 4, low: 7 },
  health: { status: "degraded" as const, estateItemCount: 128 },
  runtime: { targetCount: 3, healthyCount: 2 },
  capturedAt: now,
  updatedAt: now,
};

function queueDelegates() {
  return {
    workQueue: { upsert: vi.fn().mockResolvedValue({ id: "queue-db-id" }) },
    workItem: {
      upsert: vi.fn().mockResolvedValue({ itemId: "job-1" }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

function dbWith(existing: unknown) {
  const create = vi.fn().mockResolvedValue({});
  const update = vi.fn().mockResolvedValue({});
  const db = {
    ...queueDelegates(),
    federationLink: { findMany: vi.fn() },
    federatedRecordMirror: {
      findUnique: vi.fn().mockResolvedValue(existing),
      create,
      update,
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as unknown as DemandDeliveryDb;
  return { db, create, update };
}

function syncedRow(capturedAt: Date, sourceOverride = source) {
  const built = buildOperationalPostureRecord({
    source: { ...sourceOverride, capturedAt, updatedAt: capturedAt },
    identity,
  });
  return {
    mirrorId: "fopo_existing",
    version: BigInt(built.record.originVersion),
    syncStatus: "synced",
    payload: {
      record: built.record,
      activity: "dpf.operational-posture.reported",
      eventId: "fope_prior",
      queuedAt: capturedAt.toISOString(),
    },
  };
}

describe("queueOperationalPostureProjection", () => {
  it("creates one local-canonical outbox row per link keyed by the reporting install", async () => {
    const { db, create } = dbWith(null);

    const result = await queueOperationalPostureProjection(db, { link, source, identity, now });

    expect(result.action).toBe("queued");
    expect(create).toHaveBeenCalledOnce();
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      federationLinkId: "link_1",
      recordType: "operational-posture",
      canonicalSide: "local",
      localRecordRef: operationalPostureLocalRef(identity.installationId),
      peerRecordRef: null,
      syncStatus: "pending",
    });
    expect(data.payload.activity).toBe("dpf.operational-posture.reported");
    expect(data.payload.record.originInstallationId).toBe(identity.installationId);
    // The durable delivery job is scheduled before any network call.
    expect((db as unknown as { workItem: { upsert: unknown } }).workItem.upsert).toHaveBeenCalledOnce();
  });

  it("is a noop when the content is unchanged and the last report is within the heartbeat", async () => {
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60_000);
    const { db, create, update } = dbWith(syncedRow(fiveMinutesAgo));

    const result = await queueOperationalPostureProjection(db, { link, source, identity, now });

    expect(result.action).toBe("noop");
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("re-reports unchanged content once the heartbeat interval has elapsed", async () => {
    const stale = new Date(now.getTime() - OPERATIONAL_POSTURE_HEARTBEAT_MS - 1);
    const { db, update } = dbWith(syncedRow(stale));

    const result = await queueOperationalPostureProjection(db, { link, source, identity, now });

    expect(result.action).toBe("queued");
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0][0].data.syncStatus).toBe("pending");
  });

  it("re-queues immediately when the content changed", async () => {
    const oneMinuteAgo = new Date(now.getTime() - 60_000);
    const { db, update } = dbWith(syncedRow(oneMinuteAgo));

    const result = await queueOperationalPostureProjection(db, {
      link, identity, now,
      source: { ...source, patchPosture: { ...source.patchPosture, critical: 1 } },
    });

    expect(result.action).toBe("queued");
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0][0].data.payload.record.patchPosture.critical).toBe(1);
  });

  it("always advances the version past the previous report", async () => {
    const future = new Date(now.getTime() + 60_000);
    const { db, update } = dbWith(syncedRow(future, { ...source, servedSha: "older" }));

    const result = await queueOperationalPostureProjection(db, { link, source, identity, now });

    expect(result.action).toBe("queued");
    expect(result.originVersion).toBe(future.getTime() + 1);
    const record = update.mock.calls[0][0].data.payload.record;
    expect(decodeOperationalPostureOutboxPayload({ record, activity: "dpf.operational-posture.reported", eventId: "x", queuedAt: "y" })).not.toBeNull();
  });

  it("refuses a source that fails minimization or validation", async () => {
    const { db, create } = dbWith(null);
    await expect(queueOperationalPostureProjection(db, {
      link, identity, now,
      source: { ...source, runtime: { targetCount: 1, healthyCount: 5 } },
    })).rejects.toThrow(/refused/);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("operationalPostureContentDigest", () => {
  it("ignores the capture time and version but not the content", () => {
    const a = buildOperationalPostureRecord({ source, identity }).record;
    const later = new Date(now.getTime() + 10_000);
    const b = buildOperationalPostureRecord({ source: { ...source, capturedAt: later, updatedAt: later }, identity }).record;
    const c = buildOperationalPostureRecord({ source: { ...source, servedSha: "other" }, identity }).record;
    expect(operationalPostureContentDigest(a)).toBe(operationalPostureContentDigest(b));
    expect(operationalPostureContentDigest(a)).not.toBe(operationalPostureContentDigest(c));
  });
});

describe("dispatchDueDemand with an operational-posture row", () => {
  it("sends the posture record and marks the row synced on an originVersion acknowledgment", async () => {
    const built = buildOperationalPostureRecord({ source, identity }).record;
    const row = {
      mirrorId: "fopo_1", federationLinkId: "link_1", recordType: "operational-posture", canonicalSide: "local",
      version: BigInt(built.originVersion), syncStatus: "pending", deliveryAttempts: 0,
      payload: { record: built, activity: "dpf.operational-posture.reported", eventId: "fope_1", queuedAt: now.toISOString() },
    };
    const update = vi.fn().mockResolvedValue({});
    const db = {
      ...queueDelegates(),
      workItem: {
        ...queueDelegates().workItem,
        findMany: vi.fn().mockResolvedValue([{ itemId: "job-1", sourceId: "fopo_1", attemptCount: 0, createdAt: now, claimedAt: null }]),
      },
      federationLink: { findMany: vi.fn().mockResolvedValue([{ ...link, role: "same-org-peer" }]) },
      federatedRecordMirror: {
        findUnique: vi.fn(), create: vi.fn(), update,
        findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([row]),
      },
    } as unknown as DemandDeliveryDb;
    const sendPosture = vi.fn().mockResolvedValue({ ok: true, status: 202, body: { ok: true, originVersion: built.originVersion } });
    const send = vi.fn();

    const result = await dispatchDueDemand(db, { now, decryptToken: () => "token", send, sendPosture });

    expect(result).toMatchObject({ attempted: 1, delivered: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(sendPosture).toHaveBeenCalledWith(
      expect.objectContaining({ linkId: "link_1", linkToken: "token", sameOrgLan: true }),
      "dpf.operational-posture.reported",
      built,
      expect.objectContaining({ eventId: "fope_1" }),
    );
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { mirrorId: "fopo_1" },
      data: expect.objectContaining({ syncStatus: "synced" }),
    }));
  });
});
