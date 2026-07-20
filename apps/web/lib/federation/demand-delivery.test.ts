import { describe, expect, it, vi } from "vitest";

import { DEMAND_PROJECTION_TEMPLATES } from "@dpf/db/federated-demand-contract";

import {
  dispatchDueDemand,
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

describe("queueDemandProjection", () => {
  it("creates a local-canonical durable outbox record before network delivery", async () => {
    const create = vi.fn().mockResolvedValue({});
    const db = {
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
      nextDeliveryAt: new Date("2026-07-20T06:06:00.000Z"),
    }) });
    const payload = create.mock.calls[0][0].data.payload;
    expect(payload.activity).toBe("dpf.demand.proposed");
    expect(JSON.stringify(payload)).not.toContain("BI-LOCAL-1");
  });

  it("does not requeue an unchanged acknowledged projection", async () => {
    const firstDb = {
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
    const db = { federationLink: { findMany: vi.fn() }, federatedRecordMirror: {
      findUnique: vi.fn().mockResolvedValue({ mirrorId: "fdmo_1", version: 10, syncStatus: "synced", payload }),
      create: vi.fn(), update, findMany: vi.fn(),
    } } as unknown as DemandDeliveryDb;

    await expect(queueDemandWithdrawal(db, "link_1", "BI-LOCAL-1", new Date("2026-07-20T06:07:00.000Z")))
      .resolves.toMatchObject({ action: "queued", activity: "dpf.demand.withdrawn" });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      syncStatus: "pending", deliveryAttempts: 0,
    }) }));
    expect(update.mock.calls[0][0].data.payload.envelope.originVersion).toBeGreaterThan(10);
  });
});

describe("dispatchDueDemand", () => {
  function deliveryDb(row: Record<string, unknown>) {
    const update = vi.fn().mockResolvedValue({});
    return {
      db: {
        federationLink: { findMany: vi.fn().mockResolvedValue([link]) },
        federatedRecordMirror: { findMany: vi.fn().mockResolvedValue([{ ...row, federationLinkId: "link_1" }]), update, findUnique: vi.fn(), create: vi.fn() },
      } as unknown as DemandDeliveryDb,
      update,
    };
  }

  const outbox = {
    mirrorId: "fdmo_1", version: 7, deliveryAttempts: 0,
    payload: { activity: "dpf.demand.updated", eventId: "evt_7", queuedAt: "2026-07-20T06:00:00.000Z", envelope: { originVersion: 7 } },
  };

  it("marks an acknowledged version synchronized", async () => {
    const { db, update } = deliveryDb(outbox);
    const send = vi.fn().mockResolvedValue({ ok: true, status: 202, body: { ok: true, originVersion: 7 } });

    const result = await dispatchDueDemand(db, {
      now: new Date("2026-07-20T06:10:00.000Z"), send, decryptToken: () => "dpflink_token",
    });

    expect(result).toEqual({ attempted: 1, delivered: 1, deferred: 0, deadLettered: 0 });
    expect(update).toHaveBeenCalledWith({ where: { mirrorId: "fdmo_1" }, data: expect.objectContaining({
      syncStatus: "synced", acknowledgedVersion: 7, nextDeliveryAt: null, lastDeliveryError: null,
    }) });
  });

  it("retains a failed delivery and schedules bounded exponential retry with jitter", async () => {
    const { db, update } = deliveryDb(outbox);
    const send = vi.fn().mockResolvedValue({ ok: false, status: 503, error: "unavailable" });

    const result = await dispatchDueDemand(db, {
      now: new Date("2026-07-20T06:10:00.000Z"), send, decryptToken: () => "dpflink_token", random: () => 0.5,
    });

    expect(result.deferred).toBe(1);
    expect(update).toHaveBeenCalledWith({ where: { mirrorId: "fdmo_1" }, data: expect.objectContaining({
      syncStatus: "pending", deliveryAttempts: 1,
      nextDeliveryAt: new Date("2026-07-20T06:10:30.000Z"),
    }) });
  });

  it("moves exhausted delivery to a visible dead-letter state", async () => {
    const { db, update } = deliveryDb({ ...outbox, deliveryAttempts: 7 });
    const send = vi.fn().mockResolvedValue({ ok: false, status: 0, error: "network error" });

    const result = await dispatchDueDemand(db, {
      now: new Date("2026-07-20T06:10:00.000Z"), send, decryptToken: () => "dpflink_token",
    });

    expect(result.deadLettered).toBe(1);
    expect(update).toHaveBeenCalledWith({ where: { mirrorId: "fdmo_1" }, data: expect.objectContaining({
      syncStatus: "dead-letter", deliveryAttempts: 8,
      deadLetteredAt: new Date("2026-07-20T06:10:00.000Z"), nextDeliveryAt: null,
    }) });
  });
});

describe("retryDelayMs", () => {
  it("caps retry at thirty minutes", () => {
    expect(retryDelayMs(1, () => 0.5)).toBe(30_000);
    expect(retryDelayMs(20, () => 0.5)).toBe(30 * 60_000);
  });
});
