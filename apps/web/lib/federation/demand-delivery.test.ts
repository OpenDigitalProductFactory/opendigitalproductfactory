import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queue/queue-telemetry", () => ({ recordQueueTransition: vi.fn().mockResolvedValue(undefined) }));

import { DEMAND_PROJECTION_TEMPLATES } from "@dpf/db/federated-demand-contract";

import {
  dispatchDueDemand,
  queueForwardedDemand,
  queueDemandProjection,
  queueDemandWithdrawal,
  retryDelayMs,
  type DemandDeliveryDb,
} from "./demand-delivery";

const identity = { installationId: `inst_${"a".repeat(32)}`, projectionSecret: "b".repeat(64) };
const source = {
  localRecordRef: "BI-LOCAL-1",
  title: "Portable request",
  summary: "A minimized explanation",
  workType: "feature",
  occurrenceCount: 2,
  product: "dpf-portal",
  createdAt: new Date("2026-07-20T06:00:00.000Z"),
  updatedAt: new Date("2026-07-20T06:05:00.000Z"),
};
const link = { linkId: "link_1", peerAuthorityUrl: "https://peer.example", peerTokenEnc: "encrypted" };
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

describe("queueDemandProjection", () => {
  it("creates a local-canonical durable outbox record before network delivery", async () => {
    const create = vi.fn().mockResolvedValue({});
    const db = {
      ...queueDelegates(),
      federationLink: { findMany: vi.fn() },
      federatedRecordMirror: {
        findUnique: vi.fn().mockResolvedValue(null),
        create,
        update: vi.fn(),
        findMany: vi.fn(),
      },
    } as unknown as DemandDeliveryDb;

    const result = await queueDemandProjection(db, {
      link,
      source,
      identity,
      contract: DEMAND_PROJECTION_TEMPLATES["same-organization"],
      audience: "internal",
      attribution: "organization",
      now: new Date("2026-07-20T06:06:00.000Z"),
    });

    expect(result.action).toBe("queued");
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      federationLinkId: "link_1",
      recordType: "demand-envelope",
      canonicalSide: "local",
      localRecordRef: "BI-LOCAL-1",
      peerRecordRef: null,
      syncStatus: "pending",
    }) });
    const payload = create.mock.calls[0][0].data.payload;
    expect(payload.activity).toBe("dpf.demand.proposed");
    expect(JSON.stringify(payload)).not.toContain("BI-LOCAL-1");
  });

  it("does not requeue an unchanged acknowledged projection", async () => {
    const firstDb = {
      ...queueDelegates(),
      federationLink: { findMany: vi.fn() },
      federatedRecordMirror: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn(),
        findMany: vi.fn(),
      },
    } as unknown as DemandDeliveryDb;
    await queueDemandProjection(firstDb, {
      link, source, identity,
      contract: DEMAND_PROJECTION_TEMPLATES["same-organization"],
      audience: "internal", attribution: "organization",
    });
    const payload = (firstDb.federatedRecordMirror.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.payload;
    const update = vi.fn();
    const db = {
      ...queueDelegates(),
      federationLink: { findMany: vi.fn() },
      federatedRecordMirror: {
        findUnique: vi.fn().mockResolvedValue({ mirrorId: "fdmo_1", version: source.updatedAt.getTime(), syncStatus: "synced", payload }),
        create: vi.fn(), update, findMany: vi.fn(),
      },
    } as unknown as DemandDeliveryDb;

    await expect(queueDemandProjection(db, {
      link, source, identity,
      contract: DEMAND_PROJECTION_TEMPLATES["same-organization"],
      audience: "internal", attribution: "organization",
    })).resolves.toMatchObject({ action: "noop" });
    expect(update).not.toHaveBeenCalled();
  });

  it("does not reset retry state for an unchanged pending projection", async () => {
    const create = vi.fn().mockResolvedValue({});
    const firstDb = {
      ...queueDelegates(),
      federationLink: { findMany: vi.fn() },
      federatedRecordMirror: { findUnique: vi.fn().mockResolvedValue(null), create, update: vi.fn(), findMany: vi.fn() },
    } as unknown as DemandDeliveryDb;
    await queueDemandProjection(firstDb, {
      link, source, identity,
      contract: DEMAND_PROJECTION_TEMPLATES["same-organization"],
      audience: "internal", attribution: "organization",
    });
    const payload = create.mock.calls[0][0].data.payload;
    const update = vi.fn();
    const db = {
      ...queueDelegates(),
      federationLink: { findMany: vi.fn() },
      federatedRecordMirror: {
        findUnique: vi.fn().mockResolvedValue({ mirrorId: "fdmo_1", version: source.updatedAt.getTime(), syncStatus: "pending", payload }),
        create: vi.fn(), update, findMany: vi.fn(),
      },
    } as unknown as DemandDeliveryDb;

    await expect(queueDemandProjection(db, {
      link, source, identity,
      contract: DEMAND_PROJECTION_TEMPLATES["same-organization"],
      audience: "internal", attribution: "organization",
    })).resolves.toMatchObject({ action: "noop" });
    expect(update).not.toHaveBeenCalled();
  });

  it("queues a higher-version withdrawal and retains the minimized prior fields", async () => {
    const payload = {
      activity: "dpf.demand.proposed",
      queuedAt: "2026-07-20T06:00:00.000Z",
      eventId: "evt_old",
      envelope: {
        specVersion: "dpf.demand/1", envelopeId: "dem_1", originInstallationId: identity.installationId,
        originRecordRef: "ref_1", originVersion: 10, route: [], audience: "internal",
        title: "Portable request", summary: "A minimized explanation", signal: { occurrenceCount: 2 },
        attribution: "organization", createdAt: "2026-07-20T06:00:00.000Z",
        updatedAt: "2026-07-20T06:00:00.000Z", payloadDigest: `sha256:${"c".repeat(64)}`,
      },
    };
    const update = vi.fn().mockResolvedValue({});
    const db = { ...queueDelegates(), federationLink: { findMany: vi.fn() }, federatedRecordMirror: {
      findUnique: vi.fn().mockResolvedValue({ mirrorId: "fdmo_1", version: 10, syncStatus: "synced", payload }),
      create: vi.fn(), update, findMany: vi.fn(),
    } } as unknown as DemandDeliveryDb;

    await expect(queueDemandWithdrawal(db, "link_1", "BI-LOCAL-1", new Date("2026-07-20T06:07:00.000Z")))
      .resolves.toMatchObject({ action: "queued", activity: "dpf.demand.withdrawn" });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      syncStatus: "pending",
    }) }));
    expect(update.mock.calls[0][0].data.payload.envelope.originVersion).toBeGreaterThan(10);
  });
});

describe("queueForwardedDemand", () => {
  it("retains original provenance and uses only a local mirror as its outbox key", async () => {
    const create = vi.fn().mockResolvedValue({});
    const db = {
      ...queueDelegates(),
      federationLink: { findMany: vi.fn() },
      federatedRecordMirror: {
        findUnique: vi.fn().mockResolvedValue(null),
        create,
        update: vi.fn(),
        findMany: vi.fn(),
      },
    } as unknown as DemandDeliveryDb;
    const forwarded = {
      specVersion: "dpf.demand/1" as const,
      envelopeId: "dem_origin",
      originInstallationId: "inst_customer",
      originRecordRef: "ref_customer",
      originVersion: 9,
      route: [{
        installationId: "inst_reseller",
        relationshipKind: "channel",
        receivedAt: "2026-07-20T06:00:00.000Z",
        attestationDigest: `sha256:${"a".repeat(64)}`,
      }],
      audience: "founder" as const,
      title: "Curated request",
      summary: "Still source-owned",
      signal: { occurrenceCount: 4 },
      attribution: "pseudonymous" as const,
      forwarding: { permitted: true, audiences: ["founder" as const] },
      createdAt: "2026-07-20T05:00:00.000Z",
      updatedAt: "2026-07-20T06:00:00.000Z",
      payloadDigest: `sha256:${"b".repeat(64)}`,
    };

    await queueForwardedDemand(db, {
      link,
      localMirrorRef: "fdm_incoming_1",
      envelope: forwarded,
      now: new Date("2026-07-20T06:01:00.000Z"),
    });

    const data = create.mock.calls[0][0].data;
    expect(data.localRecordRef).toBe("forward:fdm_incoming_1");
    expect(data.payload.envelope.originInstallationId).toBe("inst_customer");
    expect(data.payload.envelope.originRecordRef).toBe("ref_customer");
    expect(data.payload.envelope.attribution).toBe("pseudonymous");
  });
});

describe("dispatchDueDemand", () => {
  function deliveryDb(row: Record<string, unknown>) {
    const update = vi.fn().mockResolvedValue({});
    const workItemUpdate = vi.fn().mockResolvedValue({});
    const job = {
      itemId: "job-1", sourceId: "fdmo_1",
      attemptCount: Number(row.deliveryAttempts ?? 0),
      createdAt: new Date("2026-07-20T06:00:00.000Z"), claimedAt: null,
    };
    return {
      db: {
        workQueue: { upsert: vi.fn().mockResolvedValue({ id: "queue-db-id" }) },
        workItem: {
          upsert: vi.fn().mockResolvedValue({ itemId: "job-1" }),
          update: workItemUpdate,
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findMany: vi.fn().mockResolvedValue([job]),
        },
        federationLink: { findMany: vi.fn().mockResolvedValue([link]) },
        federatedRecordMirror: {
          findMany: vi.fn()
            .mockResolvedValueOnce([{ mirrorId: "fdmo_1" }])
            .mockResolvedValueOnce([{ ...row, federationLinkId: "link_1" }]),
          update, findUnique: vi.fn(), create: vi.fn(),
        },
      } as unknown as DemandDeliveryDb,
      update,
      workItemUpdate,
    };
  }

  const outbox = {
    mirrorId: "fdmo_1", version: 7, deliveryAttempts: 0,
    payload: { activity: "dpf.demand.updated", eventId: "evt_7", queuedAt: "2026-07-20T06:00:00.000Z", envelope: { originVersion: 7 } },
  };

  it("marks an acknowledged version synchronized", async () => {
    const { db, update, workItemUpdate } = deliveryDb(outbox);
    const send = vi.fn().mockResolvedValue({ ok: true, status: 202, body: { ok: true, originVersion: 7 } });

    const result = await dispatchDueDemand(db, {
      now: new Date("2026-07-20T06:10:00.000Z"), send, decryptToken: () => "dpflink_token",
    });

    expect(result).toEqual({ attempted: 1, delivered: 1, deferred: 0, deadLettered: 0 });
    expect(update).toHaveBeenCalledWith({ where: { mirrorId: "fdmo_1" }, data: expect.objectContaining({
      syncStatus: "synced", acknowledgedVersion: 7,
    }) });
    expect(workItemUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) }));
  });

  it("retains a failed delivery and schedules bounded exponential retry with jitter", async () => {
    const { db, workItemUpdate } = deliveryDb(outbox);
    const send = vi.fn().mockResolvedValue({ ok: false, status: 503, error: "unavailable" });

    const result = await dispatchDueDemand(db, {
      now: new Date("2026-07-20T06:10:00.000Z"), send, decryptToken: () => "dpflink_token", random: () => 0.5,
    });

    expect(result.deferred).toBe(1);
    expect(workItemUpdate).toHaveBeenCalledWith({ where: { itemId: "job-1" }, data: expect.objectContaining({
      status: "queued", attemptCount: 1, nextAttemptAt: new Date("2026-07-20T06:10:30.000Z"),
    }) });
  });

  it("moves exhausted delivery to a visible dead-letter state", async () => {
    const { db, update, workItemUpdate } = deliveryDb({ ...outbox, deliveryAttempts: 7 });
    const send = vi.fn().mockResolvedValue({ ok: false, status: 0, error: "network error" });

    const result = await dispatchDueDemand(db, {
      now: new Date("2026-07-20T06:10:00.000Z"), send, decryptToken: () => "dpflink_token",
    });

    expect(result.deadLettered).toBe(1);
    expect(update).toHaveBeenCalledWith({ where: { mirrorId: "fdmo_1" }, data: expect.objectContaining({
      syncStatus: "dead-letter", deadLetteredAt: new Date("2026-07-20T06:10:00.000Z"),
    }) });
    expect(workItemUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed", attemptCount: 8 }) }));
  });
});

describe("retryDelayMs", () => {
  it("caps retry at thirty minutes", () => {
    expect(retryDelayMs(1, () => 0.5)).toBe(30_000);
    expect(retryDelayMs(20, () => 0.5)).toBe(30 * 60_000);
  });
});
