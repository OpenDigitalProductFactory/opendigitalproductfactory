import { describe, expect, it, vi } from "vitest";

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

    const second = db({ shared, existingResponse: { mirrorId: "fdri_existing" } });
    await expect(handleIncomingDemandResponse(second.value, "link_1", response()))
      .resolves.toMatchObject({ action: "noop", responseId: "rsp_opaque" });
    expect(second.create).not.toHaveBeenCalled();
  });

  it("rejects a response for an envelope that was never shared on the link", async () => {
    const { value, create } = db({ shared: [] });
    await expect(handleIncomingDemandResponse(value, "link_1", response()))
      .resolves.toEqual({ action: "rejected", violations: ["response:unknown-envelope"] });
    expect(create).not.toHaveBeenCalled();
  });
});
