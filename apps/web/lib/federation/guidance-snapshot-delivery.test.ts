import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queue/queue-telemetry", () => ({ recordQueueTransition: vi.fn().mockResolvedValue(undefined) }));

import { dispatchDueDemand, type DemandDeliveryDb } from "./demand-delivery";
import { issueGuidanceSnapshot } from "./guidance-snapshot";
import { deriveDeviceId, generateInstanceSigningKeypair } from "./instance-identity";

const now = new Date("2026-11-11T00:00:00.000Z");
const link = { linkId: "link_1", peerAuthorityUrl: "https://companion.example", peerTokenEnc: "encrypted" };

function queueDelegates() {
  return {
    workQueue: { upsert: vi.fn().mockResolvedValue({ id: "queue-db-id" }) },
    workItem: {
      upsert: vi.fn().mockResolvedValue({ itemId: "job-1" }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([{ itemId: "job-1", sourceId: "fgso_1", attemptCount: 0, createdAt: now, claimedAt: null }]),
    },
  };
}

describe("dispatchDueDemand — guidance snapshot rows (BI-1B165D02)", () => {
  it("delivers the snapshot to the companion and marks it synced once the companion holds that version", async () => {
    const authority = generateInstanceSigningKeypair();
    const record = issueGuidanceSnapshot({
      authority,
      companionInstallationDid: deriveDeviceId(generateInstanceSigningKeypair().signingPublicKey),
      wwwd: {
        profile: { profileId: "wwwd-org-1", name: "Org", fallbackProfileId: null, autonomyPolicy: null, defaultResolver: null },
        materials: [],
      },
      version: now.getTime(),
      now,
    });
    const row = {
      mirrorId: "fgso_1", federationLinkId: "link_1", recordType: "guidance-snapshot", canonicalSide: "local",
      version: BigInt(record.meta.version), syncStatus: "pending", deliveryAttempts: 0,
      payload: { record, activity: "dpf.guidance-snapshot.published", eventId: "fgse_1", queuedAt: now.toISOString() },
    };
    const update = vi.fn().mockResolvedValue({});
    const db = {
      ...queueDelegates(),
      federationLink: { findMany: vi.fn().mockResolvedValue([{ ...link, role: "same-org-peer" }]) },
      federatedRecordMirror: {
        findUnique: vi.fn(), create: vi.fn(), update,
        findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([row]),
      },
    } as unknown as DemandDeliveryDb;
    const sendGuidance = vi.fn().mockResolvedValue({ ok: true, status: 202, body: { ok: true, originVersion: record.meta.version } });
    const send = vi.fn();

    const result = await dispatchDueDemand(db, { now, decryptToken: () => "token", send, sendGuidance });

    expect(result).toMatchObject({ attempted: 1, delivered: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(sendGuidance).toHaveBeenCalledWith(
      expect.objectContaining({ linkId: "link_1", linkToken: "token", sameOrgLan: true }),
      "dpf.guidance-snapshot.published",
      record,
      expect.objectContaining({ eventId: "fgse_1" }),
    );
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { mirrorId: "fgso_1" },
      data: expect.objectContaining({ syncStatus: "synced" }),
    }));
  });
});
