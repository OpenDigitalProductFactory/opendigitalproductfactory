import { describe, expect, it, vi } from "vitest";

import type { DemandDigestV1 } from "@dpf/db/federated-demand-contract";

import {
  compareIncomingDemandDigest,
  reconcileDemandDigests,
  type DemandDigestDb,
} from "./demand-digest";

const digest: DemandDigestV1 = {
  specVersion: "dpf.demand-digest/1",
  originInstallationId: "inst_origin",
  generatedAt: "2026-07-20T06:00:00.000Z",
  records: [
    { originRecordRef: "ref_missing", originVersion: 1, payloadDigest: "sha256:one", withdrawn: false },
    { originRecordRef: "ref_stale", originVersion: 3, payloadDigest: "sha256:three", withdrawn: false },
    { originRecordRef: "ref_divergent", originVersion: 4, payloadDigest: "sha256:four", withdrawn: false },
    { originRecordRef: "ref_current", originVersion: 5, payloadDigest: "sha256:five", withdrawn: false },
  ],
};

describe("compareIncomingDemandDigest", () => {
  it("requests only missing, stale, or same-version divergent envelopes", async () => {
    const db = { federatedRecordMirror: { findMany: vi.fn().mockResolvedValue([
      { peerRecordRef: "inst_origin:ref_stale", version: 2, syncStatus: "synced", payload: { envelope: { payloadDigest: "sha256:two" } } },
      { peerRecordRef: "inst_origin:ref_divergent", version: 4, syncStatus: "synced", payload: { envelope: { payloadDigest: "sha256:different" } } },
      { peerRecordRef: "inst_origin:ref_current", version: 5, syncStatus: "synced", payload: { envelope: { payloadDigest: "sha256:five" } } },
    ]) } } as unknown as DemandDigestDb;

    const result = await compareIncomingDemandDigest(db, "link_1", digest);

    expect(result.needs).toEqual([
      { originRecordRef: "ref_missing", reason: "missing" },
      { originRecordRef: "ref_stale", reason: "stale", haveVersion: 2 },
      { originRecordRef: "ref_divergent", reason: "digest-mismatch", haveVersion: 4 },
    ]);
  });
});

describe("reconcileDemandDigests", () => {
  it("requeues peer-requested records and acknowledges records the peer already has", async () => {
    const update = vi.fn().mockResolvedValue({});
    const db = {
      federationLink: { findMany: vi.fn().mockResolvedValue([
        { linkId: "link_1", peerAuthorityUrl: "https://peer.example", peerTokenEnc: "encrypted" },
      ]) },
      federatedRecordMirror: {
        findMany: vi.fn().mockResolvedValue([
          { mirrorId: "out_1", federationLinkId: "link_1", version: 1, syncStatus: "conflict", payload: {
            activity: "dpf.demand.proposed", eventId: "evt_1", queuedAt: digest.generatedAt,
            envelope: { ...digest.records[0], specVersion: "dpf.demand/1", originInstallationId: "inst_origin" },
          } },
          { mirrorId: "out_2", federationLinkId: "link_1", version: 5, syncStatus: "pending", payload: {
            activity: "dpf.demand.updated", eventId: "evt_2", queuedAt: digest.generatedAt,
            envelope: { ...digest.records[3], specVersion: "dpf.demand/1", originInstallationId: "inst_origin" },
          } },
        ]),
        update,
      },
    } as unknown as DemandDigestDb;
    const send = vi.fn().mockResolvedValue({
      ok: true, status: 200, body: { ok: true, checked: 2, needs: [{ originRecordRef: "ref_missing", reason: "missing" }] },
    });

    const result = await reconcileDemandDigests(db, {
      installationId: "inst_origin", projectionSecret: "a".repeat(64),
    }, {
      now: new Date("2026-07-20T06:10:00Z"), decryptToken: () => "dpflink_token", send,
    });

    expect(result).toEqual({ linksChecked: 1, requeued: 1, confirmed: 1, failedLinks: 0 });
    expect(update).toHaveBeenCalledWith({ where: { mirrorId: "out_1" }, data: expect.objectContaining({
      syncStatus: "pending", deliveryAttempts: 0, nextDeliveryAt: new Date("2026-07-20T06:10:00Z"),
    }) });
    expect(update).toHaveBeenCalledWith({ where: { mirrorId: "out_2" }, data: expect.objectContaining({
      syncStatus: "synced", acknowledgedVersion: 5, nextDeliveryAt: null,
    }) });
  });
});
