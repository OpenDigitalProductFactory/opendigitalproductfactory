import { describe, expect, it, vi } from "vitest";

import { computeDemandPayloadDigest, type DemandEnvelopeV1 } from "@dpf/db/federated-demand-contract";

import { handleIncomingDemandDisposition, queueFounderDispositionNotices } from "./demand-disposition";

function envelope(): DemandEnvelopeV1 {
  const value: DemandEnvelopeV1 = {
    specVersion: "dpf.demand/1",
    envelopeId: "dem_opaque",
    originInstallationId: `inst_${"a".repeat(32)}`,
    originRecordRef: "ref_opaque",
    originVersion: 1,
    route: [],
    audience: "founder",
    title: "Shared need",
    summary: "Minimized context",
    signal: { occurrenceCount: 1 },
    attribution: "pseudonymous",
    createdAt: "2026-07-20T08:00:00.000Z",
    updatedAt: "2026-07-20T08:00:00.000Z",
    payloadDigest: "sha256:pending",
  };
  value.payloadDigest = computeDemandPayloadDigest(value);
  return value;
}

describe("founder disposition return path", () => {
  it("queues one durable notice on every observed ingress route", async () => {
    const create = vi.fn().mockResolvedValue({});
    const db = { federatedRecordMirror: {
      findMany: vi.fn().mockResolvedValue([
        { mirrorId: "direct", federationLinkId: "link_direct", payload: {} },
        { mirrorId: "reseller", federationLinkId: "link_reseller", payload: {} },
      ]),
      findUnique: vi.fn().mockResolvedValue(null),
      create,
      update: vi.fn(),
    }, federationLink: { findMany: vi.fn() } };
    const result = await queueFounderDispositionNotices(db as never, {
      clusterId: "FDC-1",
      decision: "accepted",
      members: [{
        originInstallationId: envelope().originInstallationId,
        envelopeId: envelope().envelopeId,
        mirrorRefs: ["direct", "reseller"],
      }],
      now: new Date("2026-07-20T08:30:00.000Z"),
    });
    expect(result).toEqual({ queued: 2 });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].data.recordType).toBe("demand-disposition");
    expect(create.mock.calls[0][0].data.version).toBe(1);
  });

  it("accepts a notice only for demand previously shared on that link", async () => {
    const demand = envelope();
    const outbox = { envelope: demand, activity: "dpf.demand.proposed", eventId: "evt", queuedAt: demand.createdAt };
    const create = vi.fn().mockResolvedValue({});
    const db = { federatedRecordMirror: {
      findMany: vi.fn().mockResolvedValue([{ mirrorId: "out", federationLinkId: "link_1", payload: outbox }]),
      findUnique: vi.fn().mockResolvedValue(null),
      create,
      update: vi.fn(),
    }, federationLink: { findMany: vi.fn() } };
    const queuedDb = { federatedRecordMirror: {
      findMany: vi.fn().mockResolvedValue([{ mirrorId: "incoming", federationLinkId: "link_1", payload: {} }]),
      findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn(),
    }, federationLink: { findMany: vi.fn() } };
    await queueFounderDispositionNotices(queuedDb as never, {
      clusterId: "FDC-1", decision: "accepted",
      members: [{ originInstallationId: demand.originInstallationId, envelopeId: demand.envelopeId, mirrorRefs: ["incoming"] }],
      now: new Date("2026-07-20T08:30:00.000Z"),
    });
    const notice = queuedDb.federatedRecordMirror.create.mock.calls[0][0].data.payload.envelope;
    await expect(handleIncomingDemandDisposition(db as never, "link_1", notice))
      .resolves.toMatchObject({ action: "created", noticeId: notice.noticeId });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
