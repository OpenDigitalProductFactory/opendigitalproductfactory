import { describe, expect, it } from "vitest";

import {
  deriveDemandSyncStatus,
  extractDemandTitle,
  mapDemandSyncActivity,
  toDemandSyncActivityRow,
  type DemandMirrorInput,
} from "./demand-activity";

function mirror(overrides: Partial<DemandMirrorInput> = {}): DemandMirrorInput {
  return {
    mirrorId: "FRM-1",
    federationLinkId: "FL-1",
    recordType: "demand",
    canonicalSide: "local",
    syncStatus: "pending",
    conflictReason: null,
    deliveryAttempts: 0,
    lastDeliveryError: null,
    deadLetteredAt: null,
    lastDeliveryAt: null,
    lastSyncedAt: null,
    updatedAt: new Date("2026-08-07T10:00:00.000Z"),
    payload: null,
    ...overrides,
  };
}

const names = new Map([["FL-1", "Windows workshop"]]);

describe("extractDemandTitle", () => {
  it("prefers a top-level title, then a nested content.title", () => {
    expect(extractDemandTitle({ title: " Fix printer " })).toBe("Fix printer");
    expect(extractDemandTitle({ content: { title: "Nested need" } })).toBe("Nested need");
  });
  it("falls back to a neutral label when no usable title is present", () => {
    expect(extractDemandTitle(null)).toBe("(demand item)");
    expect(extractDemandTitle({ title: "   " })).toBe("(demand item)");
    expect(extractDemandTitle("nope")).toBe("(demand item)");
  });
});

describe("deriveDemandSyncStatus", () => {
  it("ranks dead-letter and conflict above the raw sync status", () => {
    expect(deriveDemandSyncStatus(mirror({ deadLetteredAt: new Date(), syncStatus: "synced" })))
      .toBe("dead-lettered");
    expect(deriveDemandSyncStatus(mirror({ conflictReason: "concurrent-update", syncStatus: "synced" })))
      .toBe("conflict");
  });
  it("maps a settled status to delivered", () => {
    for (const s of ["synced", "acknowledged", "delivered"]) {
      expect(deriveDemandSyncStatus(mirror({ syncStatus: s }))).toBe("delivered");
    }
  });
  it("surfaces a pending row that carries a delivery error as failed, not silent", () => {
    expect(deriveDemandSyncStatus(mirror({ syncStatus: "pending", lastDeliveryError: "peer responded 422" })))
      .toBe("failed");
  });
  it("is pending when nothing has gone wrong yet", () => {
    expect(deriveDemandSyncStatus(mirror())).toBe("pending");
  });
});

describe("toDemandSyncActivityRow provenance", () => {
  it("labels a locally-originated item as outbound FROM this installation", () => {
    const row = toDemandSyncActivityRow(mirror({ canonicalSide: "local" }), names);
    expect(row.direction).toBe("outbound");
    expect(row.originLabel).toBe("This installation");
    expect(row.peerLabel).toBe("Windows workshop");
  });
  it("labels a peer-originated item as inbound FROM the peer", () => {
    const row = toDemandSyncActivityRow(mirror({ canonicalSide: "peer" }), names);
    expect(row.direction).toBe("inbound");
    expect(row.originLabel).toBe("Windows workshop");
    expect(row.peerLabel).toBe("Windows workshop");
  });
  it("names an unknown connection rather than leaking the raw linkId as origin", () => {
    const row = toDemandSyncActivityRow(mirror({ federationLinkId: "FL-UNKNOWN" }), names);
    expect(row.peerLabel).toBe("Unknown connection");
  });
  it("exposes the stuck reason and attempt count for a failed delivery", () => {
    const row = toDemandSyncActivityRow(
      mirror({ syncStatus: "pending", lastDeliveryError: "peer responded 422", deliveryAttempts: 5 }),
      names,
    );
    expect(row.status).toBe("failed");
    expect(row.detail).toBe("peer responded 422");
    expect(row.attempts).toBe(5);
  });
  it("uses the canonical queue job for outbound retry and dead-letter telemetry", () => {
    const row = toDemandSyncActivityRow(
      mirror({ syncStatus: "pending", deliveryAttempts: 0 }),
      names,
      {
        sourceId: "FRM-1",
        status: "failed",
        attemptCount: 8,
        nextAttemptAt: null,
        lastAttemptAt: new Date("2026-08-08T12:00:00.000Z"),
        lastError: "peer remained unavailable",
        completedAt: null,
      },
    );
    expect(row).toMatchObject({
      status: "dead-lettered",
      attempts: 8,
      detail: "peer remained unavailable",
      lastActivityISO: "2026-08-08T12:00:00.000Z",
    });
  });
});

describe("mapDemandSyncActivity", () => {
  it("orders newest activity first, using lastDeliveryAt over updatedAt", () => {
    const rows = mapDemandSyncActivity(
      [
        mirror({ mirrorId: "old", updatedAt: new Date("2026-08-01T00:00:00.000Z") }),
        mirror({ mirrorId: "new", lastDeliveryAt: new Date("2026-08-07T12:00:00.000Z") }),
      ],
      names,
    );
    expect(rows.map((r) => r.mirrorId)).toEqual(["new", "old"]);
  });
});
