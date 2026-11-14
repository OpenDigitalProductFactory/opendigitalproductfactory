import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queue/queue-telemetry", () => ({ recordQueueTransition: vi.fn().mockResolvedValue(undefined) }));

import { dispatchDueDemand, type DemandDeliveryDb } from "./demand-delivery";

const now = new Date("2026-11-12T00:00:00.000Z"); // clock-bomb-guard: allow injected clock; the code reads no wall clock

function queueDelegates() {
  return {
    workQueue: { upsert: vi.fn().mockResolvedValue({ id: "queue-db-id" }) },
    workItem: {
      upsert: vi.fn().mockResolvedValue({ itemId: "job-1" }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([{ itemId: "job-1", sourceId: "fwc_1", attemptCount: 0, createdAt: now, claimedAt: null }]),
    },
  };
}

describe("dispatchDueDemand — claim requests (BI-30EDDB7F)", () => {
  it("applies the home's answer from the acknowledgement to the requesting Workroom", async () => {
    const envelope = {
      specVersion: "dpf.demand-response/1", responseId: "rsp_claim", envelopeId: "work:BI-HOME",
      originInstallationId: "inst_home", originRecordRef: "BI-HOME", responseKind: "help-offer",
      responderAttribution: "organization", createdAt: now.toISOString(), payloadDigest: "sha256:x",
      workClaim: { itemId: "BI-HOME", action: "claim", requesterInstallationId: "inst_dev", requesterWorkroomId: "WC-DEV", repositoryFullName: "org/repo", headBranch: "feat/x" },
    };
    const row = {
      mirrorId: "fwc_1", federationLinkId: "link_1", recordType: "demand-response", canonicalSide: "local",
      version: BigInt(now.getTime()), syncStatus: "pending", deliveryAttempts: 0,
      payload: { envelope, activity: "dpf.demand.help-offered", eventId: "rsp_claim", queuedAt: now.toISOString() },
    };
    const update = vi.fn().mockResolvedValue({});
    const db = {
      ...queueDelegates(),
      federationLink: { findMany: vi.fn().mockResolvedValue([{ linkId: "link_1", peerAuthorityUrl: "https://home.example", peerTokenEnc: "enc", role: "same-org-peer" }]) },
      federatedRecordMirror: {
        findUnique: vi.fn(), create: vi.fn(), update,
        findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([row]),
      },
    } as unknown as DemandDeliveryDb;
    const decision = { decision: "refused", reason: "held-elsewhere", holder: { installationId: "inst_home", workroomId: "WC-HOME", leaseExpiresAt: null }, message: "held" };
    const send = vi.fn().mockResolvedValue({ ok: true, status: 200, body: { ok: true, responseId: "rsp_claim", workClaim: decision } });
    const applyWorkClaim = vi.fn().mockResolvedValue(undefined);

    const result = await dispatchDueDemand(db, { now, decryptToken: () => "token", send, applyWorkClaim });

    expect(result).toMatchObject({ attempted: 1, delivered: 1 });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ linkId: "link_1" }), "dpf.demand.help-offered", envelope, expect.anything());
    expect(applyWorkClaim).toHaveBeenCalledWith("WC-DEV", decision);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { mirrorId: "fwc_1" }, data: expect.objectContaining({ syncStatus: "synced" }) }));
  });
});
