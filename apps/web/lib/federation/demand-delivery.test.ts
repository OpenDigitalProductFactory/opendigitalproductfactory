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
  classifyDeliveryFailure,
} from "./demand-delivery";

const identity = { installationId: `inst_${"a".repeat(32)}`, projectionSecret: "b".repeat(64) };
const source = {
  localRecordRef: "BI-LOCAL-1",
  title: "Portable request",
  summary: "A minimized explanation",
  workType: "feature",
  occurrenceCount: 2,
  product: "dpf-portal",
  scopeKind: "platform",
  archetypeCategories: [],
  archetypeIds: [],
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

    expect(result).toEqual({
      attempted: 1, delivered: 1, deferred: 0, deadLettered: 0,
      unreachable: 0, quarantinedLinks: [], withdrawn: 0,
    });
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

  // This test used to assert that a `status: 0` network error dead-letters after
  // eight attempts. That was the defect, not the contract. With a 30s..30m
  // backoff the budget exhausts in about an hour, so an install that simply
  // could not see its peer — a laptop away from the home LAN — wrote off every
  // queued item an hour after enqueueing it. Observed 2026-09-15 with 1,323
  // failed items against a peer that was merely out of reach. Dead-lettering is
  // now reserved for a peer that ANSWERED and refused.
  it("moves exhausted delivery to a visible dead-letter state when the peer REJECTS it", async () => {
    const { db, update, workItemUpdate } = deliveryDb({ ...outbox, deliveryAttempts: 7 });
    const send = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const result = await dispatchDueDemand(db, {
      now: new Date("2026-07-20T06:10:00.000Z"), send, decryptToken: () => "dpflink_token",
    });

    expect(result.deadLettered).toBe(1);
    expect(update).toHaveBeenCalledWith({ where: { mirrorId: "fdmo_1" }, data: expect.objectContaining({
      syncStatus: "dead-letter", deadLetteredAt: new Date("2026-07-20T06:10:00.000Z"),
    }) });
    expect(workItemUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed", attemptCount: 8 }) }));
  });

  it("never dead-letters an item it could not deliver because the peer was unreachable", async () => {
    // Same exhausted budget as above (7 prior attempts), but the peer was never
    // reached. Distance is not evidence about the payload, so the item holds.
    const { db, update, workItemUpdate } = deliveryDb({ ...outbox, deliveryAttempts: 7 });
    const send = vi.fn().mockResolvedValue({ ok: false, status: 0, error: "network error" });

    const result = await dispatchDueDemand(db, {
      now: new Date("2026-07-20T06:10:00.000Z"), send, decryptToken: () => "dpflink_token",
    });

    expect(result.deadLettered).toBe(0);
    expect(result.unreachable).toBe(1);
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ syncStatus: "dead-letter" }),
    }));
    // Still queued past the point that previously dead-lettered it. The attempt
    // is counted and the backoff widens, but the item can now wait out an
    // absence of any length and drain intact on return.
    expect(workItemUpdate).toHaveBeenCalledWith({ where: { itemId: "job-1" }, data: expect.objectContaining({
      status: "queued", attemptCount: 8,
    }) });
  });

  it("quarantines a link once a retried item is still refused on auth", async () => {
    // The observed install carried 1,083 consecutive 401/403 rejections across
    // eight links and quarantined none: the column existed, nothing set it. A
    // credential refusal is settled — retrying cannot change it.
    const { db } = deliveryDb({ ...outbox, deliveryAttempts: 1 });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    (db.federationLink as { updateMany?: unknown }).updateMany = updateMany;
    const send = vi.fn().mockResolvedValue({ ok: false, status: 403 });

    const result = await dispatchDueDemand(db, {
      now: new Date("2026-07-20T06:10:00.000Z"), send, decryptToken: () => "dpflink_token",
    });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ linkState: "trusted", quarantinedAt: null }),
      data: expect.objectContaining({ quarantinedAt: new Date("2026-07-20T06:10:00.000Z") }),
    }));
    expect(result.quarantinedLinks).toEqual(["link_1"]);
  });

  it("gives a first-attempt auth rejection one retry before quarantining", async () => {
    // A token mid-rotation should not fence the link on its very first refusal.
    const { db } = deliveryDb({ ...outbox, deliveryAttempts: 0 });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    (db.federationLink as { updateMany?: unknown }).updateMany = updateMany;
    const send = vi.fn().mockResolvedValue({ ok: false, status: 401 });

    const result = await dispatchDueDemand(db, {
      now: new Date("2026-07-20T06:10:00.000Z"), send, decryptToken: () => "dpflink_token",
    });

    expect(updateMany).not.toHaveBeenCalled();
    expect(result.quarantinedLinks).toEqual([]);
  });

  it("classifies the two failure shapes the drain must treat differently", () => {
    expect(classifyDeliveryFailure(0)).toBe("unreachable");
    expect(classifyDeliveryFailure(401)).toBe("rejected-auth");
    expect(classifyDeliveryFailure(403)).toBe("rejected-auth");
    expect(classifyDeliveryFailure(404)).toBe("rejected-other");
    expect(classifyDeliveryFailure(500)).toBe("rejected-other");
  });
});

describe("retryDelayMs", () => {
  it("caps retry at thirty minutes", () => {
    expect(retryDelayMs(1, () => 0.5)).toBe(30_000);
    expect(retryDelayMs(20, () => 0.5)).toBe(30 * 60_000);
  });
});

describe("dispatchDueDemand queue churn (BI-5993AE7F)", () => {
  // The legacy-mirror bridge used to call ensureFederationDeliveryJob for EVERY
  // pending mirror on EVERY sweep, and each of those re-upserted the same single
  // WorkQueue row. Against a backlog that cannot drain while the peer is offline
  // that measured ~708 writes/sec on a five-row table. These pin both halves of
  // the fix: resolve the queue once, and bridge only mirrors that lack a job.
  function churnDb(pendingMirrorIds: string[], alreadyBridged: string[]) {
    const workQueueUpsert = vi.fn().mockResolvedValue({ id: "queue-db-id" });
    const workItemUpsert = vi.fn().mockResolvedValue({ itemId: "job-x" });
    const workItemFindMany = vi.fn()
      // 1st: the bridge's "which of these mirrors already have a job" probe.
      .mockResolvedValueOnce(alreadyBridged.map((sourceId) => ({
        itemId: `job-${sourceId}`, sourceId, attemptCount: 0,
        createdAt: new Date("2026-07-20T06:00:00.000Z"), claimedAt: null,
      })))
      // 2nd: the due-jobs query. Nothing due — this test is about the bridge.
      .mockResolvedValueOnce([]);
    return {
      db: {
        workQueue: { upsert: workQueueUpsert },
        workItem: {
          upsert: workItemUpsert, update: vi.fn().mockResolvedValue({}),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }), findMany: workItemFindMany,
        },
        federationLink: { findMany: vi.fn().mockResolvedValue([]) },
        federatedRecordMirror: {
          findMany: vi.fn()
            .mockResolvedValueOnce(pendingMirrorIds.map((mirrorId) => ({ mirrorId })))
            .mockResolvedValue([]),
          update: vi.fn().mockResolvedValue({}), findUnique: vi.fn(), create: vi.fn(),
        },
      } as unknown as DemandDeliveryDb,
      workQueueUpsert,
      workItemUpsert,
    };
  }

  const now = new Date("2026-07-20T06:10:00.000Z");

  it("never touches the queue row when every pending mirror already has a job", async () => {
    const { db, workQueueUpsert, workItemUpsert } = churnDb(["m1", "m2", "m3"], ["m1", "m2", "m3"]);

    await dispatchDueDemand(db, { now });

    // Steady state with an unreachable peer: the backlog cannot drain, so this
    // path runs every sweep forever. It must cost zero writes.
    expect(workQueueUpsert).not.toHaveBeenCalled();
    expect(workItemUpsert).not.toHaveBeenCalled();
  });

  it("resolves the queue once, not once per unbridged mirror", async () => {
    const { db, workQueueUpsert, workItemUpsert } = churnDb(["m1", "m2", "m3"], []);

    await dispatchDueDemand(db, { now });

    expect(workQueueUpsert).toHaveBeenCalledTimes(1);
    expect(workItemUpsert).toHaveBeenCalledTimes(3);
  });

  it("bridges only the mirrors that are missing a job", async () => {
    const { db, workQueueUpsert, workItemUpsert } = churnDb(["m1", "m2", "m3"], ["m1", "m3"]);

    await dispatchDueDemand(db, { now });

    expect(workQueueUpsert).toHaveBeenCalledTimes(1);
    expect(workItemUpsert).toHaveBeenCalledTimes(1);
    expect(workItemUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { sourceKey: "federation-demand:m2" },
    }));
  });
});

describe("dispatchDueDemand head-of-line (BI-26E3B9C9)", () => {
  // The sweep reads the 50 oldest due jobs and then drops every row whose link
  // is not deliverable — without finishing the job. A job for a revoked link was
  // therefore left `queued` and due, and the next sweep selected it again. On the
  // operator's install (2026-10-27) the whole 50-job window was revoked-link
  // jobs, so the one trusted link's 2,534 pending envelopes had never been
  // attempted since 2026-09-03.
  const now = new Date("2026-10-27T18:00:00.000Z");
  const due = (sourceId: string) => ({
    itemId: `job-${sourceId}`, sourceId, attemptCount: 1,
    createdAt: new Date("2026-09-01T00:00:00.000Z"), claimedAt: null,
  });
  const pending = (mirrorId: string, federationLinkId: string) => ({
    mirrorId, federationLinkId, recordType: "demand-envelope", version: 7, deliveryAttempts: 1,
    payload: { activity: "dpf.demand.updated", eventId: `evt_${mirrorId}`, queuedAt: "2026-09-01T00:00:00.000Z", envelope: { originVersion: 7 } },
  });
  const links = [
    { linkId: "link_live", peerAuthorityUrl: "https://peer.example", peerTokenEnc: "enc", role: "same-org-peer", linkState: "trusted", revokedAt: null, quarantinedAt: null },
    { linkId: "link_gone", peerAuthorityUrl: "https://old.example", peerTokenEnc: "enc", role: "same-org-peer", linkState: "revoked", revokedAt: new Date("2026-09-06T00:00:00.000Z"), quarantinedAt: null },
    { linkId: "link_fenced", peerAuthorityUrl: "https://fenced.example", peerTokenEnc: "enc", role: "same-org-peer", linkState: "trusted", revokedAt: null, quarantinedAt: new Date("2026-10-01T00:00:00.000Z") },
  ];

  function hol(jobs: ReturnType<typeof due>[], rows: ReturnType<typeof pending>[]) {
    const mirrorUpdate = vi.fn().mockResolvedValue({});
    const workItemUpdate = vi.fn().mockResolvedValue({});
    const db = {
      workQueue: { upsert: vi.fn().mockResolvedValue({ id: "queue-db-id" }) },
      workItem: {
        upsert: vi.fn(), update: workItemUpdate,
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn()
          .mockResolvedValueOnce(jobs.map((job) => ({ ...job })))
          .mockResolvedValueOnce(jobs),
      },
      federationLink: {
        findMany: vi.fn().mockImplementation(async (args: { where: { linkState?: string; linkId: { in: string[] } } }) => {
          const wanted = links.filter((candidate) => args.where.linkId.in.includes(candidate.linkId));
          return args.where.linkState === "trusted"
            ? wanted.filter((candidate) => candidate.linkState === "trusted" && !candidate.revokedAt && !candidate.quarantinedAt)
            : wanted;
        }),
      },
      federatedRecordMirror: {
        findMany: vi.fn()
          .mockResolvedValueOnce(rows.map((row) => ({ mirrorId: row.mirrorId })))
          .mockResolvedValueOnce(rows),
        update: mirrorUpdate, findUnique: vi.fn(), create: vi.fn(),
      },
    } as unknown as DemandDeliveryDb;
    return { db, mirrorUpdate, workItemUpdate };
  }

  it("withdraws a revoked link's job instead of leaving it at the head of the queue", async () => {
    const { db, mirrorUpdate, workItemUpdate } = hol([due("m_gone")], [pending("m_gone", "link_gone")]);

    const result = await dispatchDueDemand(db, { now, decryptToken: () => "dpflink_token", send: vi.fn() });

    expect(result.withdrawn).toBe(1);
    expect(mirrorUpdate).toHaveBeenCalledWith({ where: { mirrorId: "m_gone" }, data: expect.objectContaining({ syncStatus: "withdrawn" }) });
    expect(workItemUpdate).toHaveBeenCalledWith({ where: { itemId: "job-m_gone" }, data: expect.objectContaining({ status: "cancelled", nextAttemptAt: null }) });
  });

  it("still delivers the trusted link's job that sits behind revoked-link jobs", async () => {
    const { db } = hol(
      [due("m_gone"), due("m_live")],
      [pending("m_gone", "link_gone"), pending("m_live", "link_live")],
    );
    const send = vi.fn().mockResolvedValue({ ok: true, status: 202, body: { ok: true, originVersion: 7 } });

    const result = await dispatchDueDemand(db, { now, decryptToken: () => "dpflink_token", send });

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.delivered).toBe(1);
    expect(result.withdrawn).toBe(1);
  });

  it("cancels a job whose mirror is no longer pending", async () => {
    const { db, workItemUpdate } = hol([due("m_done")], []);

    const result = await dispatchDueDemand(db, { now, decryptToken: () => "dpflink_token", send: vi.fn() });

    expect(result.withdrawn).toBe(1);
    expect(workItemUpdate).toHaveBeenCalledWith({ where: { itemId: "job-m_done" }, data: expect.objectContaining({ status: "cancelled" }) });
  });

  it("holds a quarantined link's job with backoff, without withdrawing its envelope", async () => {
    const { db, mirrorUpdate, workItemUpdate } = hol([due("m_fenced")], [pending("m_fenced", "link_fenced")]);

    const result = await dispatchDueDemand(db, { now, decryptToken: () => "dpflink_token", send: vi.fn(), random: () => 0.5 });

    expect(result.withdrawn).toBe(0);
    expect(mirrorUpdate).not.toHaveBeenCalled();
    expect(workItemUpdate).toHaveBeenCalledWith({ where: { itemId: "job-m_fenced" }, data: expect.objectContaining({
      status: "queued", nextAttemptAt: expect.any(Date),
    }) });
    const scheduled = workItemUpdate.mock.calls[0][0].data.nextAttemptAt as Date;
    expect(scheduled.getTime()).toBeGreaterThan(now.getTime());
  });
});
