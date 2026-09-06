import { describe, expect, it, vi } from "vitest";

import { OPERATIONAL_POSTURE_HEARTBEAT_MS } from "./operational-posture-delivery";
import { buildOperationalPostureRecord } from "./operational-posture-projection";
import {
  POSTURE_FRESH_WINDOW_MS,
  POSTURE_SILENT_AFTER_MS,
  classifyPostureFreshness,
  formatPostureAge,
  loadPairedEstatePosture,
  mapPairedEstatePosture,
  type PairedEstatePostureDb,
} from "./operational-posture-read-model";

const now = new Date("2026-09-06T12:00:00.000Z");
const peerIdentity = { installationId: `inst_${"d".repeat(32)}`, projectionSecret: "e".repeat(64) };
const localIdentity = { installationId: `inst_${"a".repeat(32)}`, label: "Example PROD" };
const localSource = {
  servedVersion: "5.12.0",
  servedSha: "abc123",
  patchPosture: { critical: 0, high: 1, medium: 2, low: 3 },
  health: { status: "degraded" as const, estateItemCount: 40 },
  runtime: { targetCount: 2, healthyCount: 1 },
  capturedAt: now,
  updatedAt: now,
};
const link = { linkId: "link_dev", peerAuthorityUrl: "http://10.0.0.5:3000", principal: { displayName: "Example DEV" } };

function peerRecord(capturedAt: Date, overrides: Partial<typeof localSource> = {}) {
  return buildOperationalPostureRecord({
    source: { ...localSource, servedVersion: "5.11.0", servedSha: "def456", ...overrides, capturedAt, updatedAt: capturedAt },
    identity: peerIdentity,
  }).record;
}

function mirrorRow(capturedAt: Date, receivedAt = capturedAt, syncStatus = "synced") {
  return {
    federationLinkId: "link_dev",
    syncStatus,
    lastSyncedAt: receivedAt,
    payload: { record: peerRecord(capturedAt), activity: "dpf.operational-posture.reported", receivedAt: receivedAt.toISOString() },
  };
}

describe("classifyPostureFreshness", () => {
  it("bands age against the heartbeat: fresh, stale, then silent", () => {
    expect(classifyPostureFreshness(0)).toBe("fresh");
    expect(classifyPostureFreshness(OPERATIONAL_POSTURE_HEARTBEAT_MS)).toBe("fresh");
    expect(classifyPostureFreshness(POSTURE_FRESH_WINDOW_MS)).toBe("stale");
    expect(classifyPostureFreshness(POSTURE_SILENT_AFTER_MS - 1)).toBe("stale");
    expect(classifyPostureFreshness(POSTURE_SILENT_AFTER_MS)).toBe("silent");
  });
});

describe("formatPostureAge", () => {
  it("renders minutes, hours and days", () => {
    expect(formatPostureAge(10_000)).toBe("just now");
    expect(formatPostureAge(4 * 60_000)).toBe("4m ago");
    expect(formatPostureAge(3 * 3_600_000)).toBe("3h ago");
    expect(formatPostureAge(72 * 3_600_000)).toBe("3d ago");
  });
});

describe("mapPairedEstatePosture", () => {
  it("places the local capture beside the peer's mirrored report, each stating basis and age", () => {
    const captured = new Date(now.getTime() - 4 * 60_000);
    const view = mapPairedEstatePosture({
      local: localSource, identity: localIdentity, links: [link], mirrors: [mirrorRow(captured)], now,
    });

    expect(view.local).toMatchObject({
      key: "local", basis: "local-capture", label: "Example PROD",
      installationId: localIdentity.installationId, servedVersion: "5.12.0", freshness: "fresh",
    });
    expect(view.local.basisLine).toBe("Captured on this installation · just now");
    expect(view.peers).toHaveLength(1);
    expect(view.peers[0]).toMatchObject({
      key: "peer:link_dev", basis: "mirrored-report", label: "Example DEV", linkId: "link_dev",
      installationId: peerIdentity.installationId, servedVersion: "5.11.0", servedSha: "def456",
      health: { status: "degraded", estateItemCount: 40 }, freshness: "fresh",
      capturedAt: captured.toISOString(),
    });
    expect(view.peers[0].basisLine).toBe("Reported by Example DEV · captured 4m ago");
    expect(view.awaiting).toEqual([]);
  });

  it("measures a peer's age from capture, not delivery, and marks missed heartbeats", () => {
    const captured = new Date(now.getTime() - 2 * OPERATIONAL_POSTURE_HEARTBEAT_MS);
    const landed = new Date(now.getTime() - 60_000);
    const view = mapPairedEstatePosture({
      local: localSource, identity: localIdentity, links: [link], mirrors: [mirrorRow(captured, landed)], now,
    });
    expect(view.peers[0].freshness).toBe("stale");
    expect(view.peers[0].receivedAt).toBe(landed.toISOString());
    expect(view.peers[0].basisLine).toContain("missed heartbeats");
    // The peer's own health band still stands while merely stale.
    expect(view.peers[0].health.status).toBe("degraded");
  });

  it("reports a silent peer as offline rather than repeating its last self-assessment", () => {
    const captured = new Date(now.getTime() - POSTURE_SILENT_AFTER_MS);
    const view = mapPairedEstatePosture({
      local: localSource, identity: localIdentity, links: [link], mirrors: [mirrorRow(captured)], now,
    });
    expect(view.peers[0].freshness).toBe("silent");
    expect(view.peers[0].health).toEqual({ status: "offline", estateItemCount: 40 });
    expect(view.peers[0].basisLine).toContain("no report since");
  });

  it("lists a trusted link with no synced report under awaiting instead of inventing a row", () => {
    const view = mapPairedEstatePosture({
      local: localSource, identity: localIdentity, links: [link],
      mirrors: [mirrorRow(now, now, "conflict")], now,
    });
    expect(view.peers).toEqual([]);
    expect(view.awaiting).toEqual([{ linkId: "link_dev", label: "Example DEV" }]);
  });
});

describe("loadPairedEstatePosture", () => {
  it("reads only trusted same-organization links and their peer-canonical posture mirrors", async () => {
    const db = {
      federationLink: { findMany: vi.fn().mockResolvedValue([link]) },
      federatedRecordMirror: { findMany: vi.fn().mockResolvedValue([mirrorRow(now)]) },
    } as unknown as PairedEstatePostureDb;

    const view = await loadPairedEstatePosture(db, localIdentity, { capture: vi.fn().mockResolvedValue(localSource), now });

    expect(view.peers).toHaveLength(1);
    expect(db.federationLink.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { role: "same-org-peer", linkState: "trusted", revokedAt: null, quarantinedAt: null },
    }));
    expect(db.federatedRecordMirror.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ recordType: "operational-posture", canonicalSide: "peer" }),
    }));
  });
});
