import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queue/queue-telemetry", () => ({ recordQueueTransition: vi.fn().mockResolvedValue(undefined) }));

import {
  computeDemandPayloadDigest,
  computeDemandResponseDigest,
  type DemandEnvelopeV1,
  type DemandResponseV1,
} from "@dpf/db/federated-demand-contract";

import { handleIncomingDemandResponse, queueDemandResponse, type DemandResponseDb } from "./demand-response";

const identity = { installationId: `inst_${"a".repeat(32)}`, projectionSecret: "b".repeat(64) };
const envelope = (): DemandEnvelopeV1 => {
  const value: DemandEnvelopeV1 = {
    specVersion: "dpf.demand/1",
    envelopeId: "dem_opaque",
    originInstallationId: identity.installationId,
    originRecordRef: "ref_opaque",
    originVersion: 1,
    route: [],
    audience: "partner",
    title: "Shared need",
    summary: "Minimized collaboration context.",
    signal: { occurrenceCount: 2 },
    attribution: "pseudonymous",
    createdAt: "2026-07-20T06:00:00.000Z",
    updatedAt: "2026-07-20T06:00:00.000Z",
    payloadDigest: "sha256:pending",
  };
  value.payloadDigest = computeDemandPayloadDigest(value);
  return value;
};

function response(): DemandResponseV1 {
  const value: DemandResponseV1 = {
    specVersion: "dpf.demand-response/1",
    responseId: "rsp_opaque",
    envelopeId: "dem_opaque",
    originInstallationId: identity.installationId,
    originRecordRef: "ref_opaque",
    responseKind: "help-offer",
    message: "We can validate this need.",
    responderAttribution: "organization",
    createdAt: "2026-07-20T06:10:00.000Z",
    payloadDigest: "sha256:pending",
  };
  value.payloadDigest = computeDemandResponseDigest(value);
  return value;
}

function db(overrides: {
  incoming?: unknown;
  existingResponse?: unknown;
  shared?: unknown[];
} = {}) {
  const create = vi.fn().mockResolvedValue({});
  const findUnique = vi.fn().mockImplementation((args: { where?: Record<string, unknown> }) => {
    if ("mirrorId" in (args.where ?? {})) return Promise.resolve(overrides.incoming ?? null);
    return Promise.resolve(overrides.existingResponse ?? null);
  });
  return {
    value: {
      workQueue: { upsert: vi.fn().mockResolvedValue({ id: "queue-db-id" }) },
      workItem: {
        upsert: vi.fn().mockResolvedValue({ itemId: "job-1" }),
        update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(),
      },
      federationLink: {
        findUnique: vi.fn().mockResolvedValue({
          linkId: "link_1", peerAuthorityUrl: "https://peer.example", peerTokenEnc: "enc",
          linkState: "trusted", revokedAt: null, quarantinedAt: null,
        }),
        findMany: vi.fn(),
      },
      federatedRecordMirror: {
        findUnique,
        findMany: vi.fn().mockResolvedValue(overrides.shared ?? []),
        create,
        update: vi.fn().mockResolvedValue({}),
      },
    } as unknown as DemandResponseDb,
    create,
  };
}

describe("queueDemandResponse", () => {
  it("queues an opaque durable help offer back to the source link", async () => {
    const incomingEnvelope = envelope();
    const { value, create } = db({ incoming: {
      mirrorId: "fdm_incoming", federationLinkId: "link_1", canonicalSide: "peer",
      localRecordRef: null, peerRecordRef: "peer", syncStatus: "synced", version: 1,
      payload: { envelope: incomingEnvelope, activity: "dpf.demand.proposed", disposition: "observed", receivedAt: incomingEnvelope.createdAt },
    } });

    const result = await queueDemandResponse(value, {
      mirrorId: "fdm_incoming", kind: "help-offer", identity,
      message: "We can validate this need.", now: new Date("2026-07-20T06:10:00.000Z"),
    });

    expect(result.action).toBe("queued");
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({ recordType: "demand-response", canonicalSide: "local", federationLinkId: "link_1" });
    expect(data.payload.activity).toBe("dpf.demand.help-offered");
    expect(JSON.stringify(data.payload)).not.toContain("fdm_incoming");
  });

  it("rejects responses to withdrawn demand", async () => {
    const incomingEnvelope = envelope();
    const { value } = db({ incoming: {
      mirrorId: "fdm_incoming", federationLinkId: "link_1", canonicalSide: "peer",
      localRecordRef: null, peerRecordRef: "peer", syncStatus: "withdrawn", version: 2,
      payload: { envelope: incomingEnvelope, activity: "dpf.demand.withdrawn", disposition: "withdrawn", receivedAt: incomingEnvelope.createdAt },
    } });

    await expect(queueDemandResponse(value, { mirrorId: "fdm_incoming", kind: "interest", identity }))
      .rejects.toThrow("Withdrawn or invalid demand");
  });
});

describe("queueDemandResponse weights (BI-626A4ECA)", () => {
  const incoming = () => {
    const incomingEnvelope = envelope();
    return {
      mirrorId: "fdm_incoming", federationLinkId: "link_1", canonicalSide: "peer",
      localRecordRef: null, peerRecordRef: "peer", syncStatus: "synced", version: 1,
      payload: { envelope: incomingEnvelope, activity: "dpf.demand.proposed", disposition: "observed", receivedAt: incomingEnvelope.createdAt },
    };
  };
  const sent = (weight?: number) => ({
    mirrorId: "fdr_sent", syncStatus: "synced",
    payload: { envelope: { responseKind: "interest", ...(weight ? { weight } : {}) }, eventId: "rsp_x" },
  });

  it("carries a weight above 1 on the wire", async () => {
    const { value, create } = db({ incoming: incoming() });
    await queueDemandResponse(value, { mirrorId: "fdm_incoming", kind: "interest", weight: 3, identity, now: new Date() });
    expect(create.mock.calls[0][0].data.payload.envelope.weight).toBe(3);
  });

  it("writes weight 1 as absent, so an unweighted vote keeps its old digest", async () => {
    const { value, create } = db({ incoming: incoming() });
    await queueDemandResponse(value, { mirrorId: "fdm_incoming", kind: "interest", weight: 1, identity, now: new Date() });
    expect(create.mock.calls[0][0].data.payload.envelope).not.toHaveProperty("weight");
  });

  it("is a no-op when the same weight was already sent", async () => {
    const { value } = db({ incoming: incoming(), existingResponse: sent(2) });
    await expect(queueDemandResponse(value, { mirrorId: "fdm_incoming", kind: "interest", weight: 2, identity }))
      .resolves.toMatchObject({ action: "noop" });
  });

  it("re-sends a re-weighted vote under a distinct event id, instead of swallowing the correction", async () => {
    const { value } = db({ incoming: incoming(), existingResponse: sent(2) });
    const result = await queueDemandResponse(value, { mirrorId: "fdm_incoming", kind: "interest", weight: 4, identity, now: new Date() });
    expect(result.action).toBe("queued");
    const update = (value.federatedRecordMirror.update as unknown as { mock: { calls: Array<Array<{ data: { payload: { envelope: { weight?: number }; eventId: string } } }>> } }).mock.calls[0][0];
    expect(update.data.payload.envelope.weight).toBe(4);
    expect(update.data.payload.eventId).not.toBe(result.responseId);
  });

  it("never weights a help offer", async () => {
    const { value, create } = db({ incoming: incoming() });
    await queueDemandResponse(value, { mirrorId: "fdm_incoming", kind: "help-offer", weight: 3, identity, now: new Date() });
    expect(create.mock.calls[0][0].data.payload.envelope).not.toHaveProperty("weight");
  });
});

describe("handleIncomingDemandResponse", () => {
  it("persists an idempotent response only for an envelope shared on the same link", async () => {
    const demand = envelope();
    const shared = [{ localRecordRef: "BI-LOCAL-1", payload: {
      envelope: demand, activity: "dpf.demand.proposed", eventId: "evt", queuedAt: demand.createdAt,
    } }];
    const first = db({ shared });
    await expect(handleIncomingDemandResponse(first.value, "link_1", response()))
      .resolves.toMatchObject({ action: "created", responseId: "rsp_opaque" });
    expect(first.create).toHaveBeenCalledTimes(1);
    // The incoming response is bound to the originator's local item (no longer orphaned).
    expect(first.create.mock.calls[0][0].data).toMatchObject({
      recordType: "demand-response", canonicalSide: "peer", localRecordRef: "BI-LOCAL-1",
    });

    // A real held row carries the response it stored; an identical replay is a no-op.
    const second = db({ shared, existingResponse: {
      mirrorId: "fdri_existing", version: 1, payload: { response: response(), receivedAt: "2026-07-20T06:10:01.000Z" },
    } });
    await expect(handleIncomingDemandResponse(second.value, "link_1", response()))
      .resolves.toMatchObject({ action: "noop", responseId: "rsp_opaque" });
    expect(second.create).not.toHaveBeenCalled();
  });

  it("applies a voter's re-weight instead of freezing the first weight (BI-626A4ECA)", async () => {
    const demand = envelope();
    const shared = [{ localRecordRef: "BI-LOCAL-1", payload: {
      envelope: demand, activity: "dpf.demand.proposed", eventId: "evt", queuedAt: demand.createdAt,
    } }];
    const original = response();
    // A later correction: strictly newer than what is held.
    const reweighted: DemandResponseV1 = { ...original, responseKind: "interest", message: undefined, weight: 3,
      createdAt: new Date(Date.parse(original.createdAt) + 60_000).toISOString(), payloadDigest: "sha256:pending" };
    delete (reweighted as { message?: string }).message;
    reweighted.payloadDigest = computeDemandResponseDigest(reweighted);
    const held = db({ shared, existingResponse: {
      mirrorId: "fdri_existing", version: 1, payload: { response: original, receivedAt: "2026-07-20T06:10:01.000Z" },
    } });
    await expect(handleIncomingDemandResponse(held.value, "link_1", reweighted))
      .resolves.toMatchObject({ action: "updated", localRecordRef: "BI-LOCAL-1" });
    const update = (held.value.federatedRecordMirror.update as unknown as { mock: { calls: Array<Array<{ data: { payload: { response: DemandResponseV1 } } }>> } }).mock.calls[0][0];
    expect(update.data.payload.response.weight).toBe(3);
  });

  it("never lets a late, older delivery revert a voter's newer weight", async () => {
    const demand = envelope();
    const shared = [{ localRecordRef: "BI-LOCAL-1", payload: {
      envelope: demand, activity: "dpf.demand.proposed", eventId: "evt", queuedAt: demand.createdAt,
    } }];
    const original = response();
    const newer: DemandResponseV1 = { ...original, responseKind: "interest", weight: 4,
      createdAt: new Date(Date.parse(original.createdAt) + 60_000).toISOString(), payloadDigest: "sha256:pending" };
    delete (newer as { message?: string }).message;
    newer.payloadDigest = computeDemandResponseDigest(newer);
    const stale: DemandResponseV1 = { ...newer, weight: 2, createdAt: original.createdAt, payloadDigest: "sha256:pending" };
    stale.payloadDigest = computeDemandResponseDigest(stale);
    const held = db({ shared, existingResponse: {
      mirrorId: "fdri_existing", version: 2, payload: { response: newer, receivedAt: "2026-07-20T06:12:00.000Z" },
    } });
    await expect(handleIncomingDemandResponse(held.value, "link_1", stale))
      .resolves.toMatchObject({ action: "noop" });
    expect(held.value.federatedRecordMirror.update).not.toHaveBeenCalled();
  });

  it("returns the local item a new response is about, so its tally can be recomputed", async () => {
    const demand = envelope();
    const shared = [{ localRecordRef: "BI-LOCAL-1", payload: {
      envelope: demand, activity: "dpf.demand.proposed", eventId: "evt", queuedAt: demand.createdAt,
    } }];
    await expect(handleIncomingDemandResponse(db({ shared }).value, "link_1", response()))
      .resolves.toMatchObject({ action: "created", localRecordRef: "BI-LOCAL-1" });
  });

  it("rejects a response for an envelope that was never shared on the link", async () => {
    const { value, create } = db({ shared: [] });
    await expect(handleIncomingDemandResponse(value, "link_1", response()))
      .resolves.toEqual({ action: "rejected", violations: ["response:unknown-envelope"] });
    expect(create).not.toHaveBeenCalled();
  });

  it("correlates an envelope past the first page (no silent take:1000 cliff)", async () => {
    const demand = envelope();
    const match = {
      mirrorId: "m_hit",
      localRecordRef: "BI-LOCAL-1",
      payload: {
        envelope: demand,
        activity: "dpf.demand.proposed",
        eventId: "evt",
        queuedAt: demand.createdAt,
      },
    };
    const create = vi.fn().mockResolvedValue({});
    const findMany = vi.fn().mockImplementation((args: {
      take: number;
      cursor?: { mirrorId: string };
      skip?: number;
    }) => {
      // Full first page of non-matches so the pager continues (length === take).
      if (!args.cursor) {
        return Promise.resolve(
          Array.from({ length: args.take }, (_, i) => ({
            mirrorId: `m_fill_${i}`,
            localRecordRef: `BI-FILL-${i}`,
            payload: {
              envelope: {
                ...demand,
                envelopeId: `dem_other_${i}`,
                originRecordRef: `ref_other_${i}`,
              },
              activity: "dpf.demand.proposed",
              eventId: "evt",
              queuedAt: demand.createdAt,
            },
          })),
        );
      }
      return Promise.resolve([match]);
    });
    const value = {
      workQueue: { upsert: vi.fn() },
      workItem: { upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
      federationLink: { findUnique: vi.fn(), findMany: vi.fn() },
      federatedRecordMirror: {
        findUnique: vi.fn().mockResolvedValue(null),
        findMany,
        create,
        update: vi.fn(),
      },
    } as unknown as DemandResponseDb;

    await expect(handleIncomingDemandResponse(value, "link_1", response()))
      .resolves.toMatchObject({ action: "created", responseId: "rsp_opaque" });
    expect(findMany.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(findMany.mock.calls[1][0]).toMatchObject({ cursor: { mirrorId: "m_fill_99" }, skip: 1 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({ localRecordRef: "BI-LOCAL-1" });
  });
});
