import { describe, expect, it, vi } from "vitest";

import {
  claimFromMirrorPayload,
  intakeOriginMarkers,
  loadFederatedTwins,
  peerWorkInProgress,
  recordFederatedTwins,
  resolveTwins,
  type TwinCandidate,
} from "./federated-twins";

const PEER = "inst_0123456789abcdef0123456789abcdef";
const MARKER = "[origin:tool-defect:surface_open]";

const local = (over: Partial<TwinCandidate> = {}): TwinCandidate => ({
  id: "row-local",
  itemId: "BI-LOCAL",
  status: "open",
  body: `Stabilize surface_open\n\n${MARKER}`,
  ...over,
});
const mirror = (over: Partial<TwinCandidate> = {}): TwinCandidate => ({
  id: "row-mirror",
  itemId: "BI-PEER",
  status: "open",
  body: `Stabilize surface_open\n\n${MARKER}\n[origin:federatedWork:${PEER}:BI-PEER]`,
  ...over,
});

describe("intakeOriginMarkers", () => {
  it("returns whole intake markers and drops federation markers", () => {
    expect(intakeOriginMarkers(mirror().body)).toEqual([MARKER]);
    expect(intakeOriginMarkers("[origin:federatedDemand:x]")).toEqual([]);
    expect(intakeOriginMarkers(null)).toEqual([]);
  });
});

describe("resolveTwins (BI-91FC6B9A)", () => {
  it("pairs a local item with the peer's mirror that shares its marker, in either direction", () => {
    expect(resolveTwins(local(), [local(), mirror()])).toEqual([
      { itemId: "BI-PEER", status: "open", marker: MARKER, peer: { installationId: PEER, itemId: "BI-PEER" }, claim: null },
    ]);
    expect(resolveTwins(mirror(), [local(), mirror()]).map((t) => t.itemId)).toEqual(["BI-LOCAL"]);
  });

  it("ignores same-side pairs, other markers and closed rows", () => {
    const otherLocal = local({ id: "row-2", itemId: "BI-LOCAL-2" });
    const otherMarker = mirror({ body: `[origin:tool-defect:surface_act]\n[origin:federatedWork:${PEER}:BI-PEER]` });
    expect(resolveTwins(local(), [otherLocal, otherMarker, mirror({ status: "done" })])).toEqual([]);
  });

  it("carries the peer claim onto the mirror twin", () => {
    const claims = new Map([["BI-PEER", { active: true, since: "2026-10-28T00:00:00.000Z", workrooms: 1 }]]);
    const [twin] = resolveTwins(local(), [mirror()], claims);
    expect(twin!.claim).toEqual({ active: true, since: "2026-10-28T00:00:00.000Z", workrooms: 1 });
    expect(peerWorkInProgress(twin!)).toBe(true);
  });
});

describe("peerWorkInProgress", () => {
  it("is true for a peer twin that is in progress or claimed, never for a local twin", () => {
    const peer = { installationId: PEER, itemId: "BI-PEER" };
    expect(peerWorkInProgress({ status: "in-progress", peer, claim: null })).toBe(true);
    expect(peerWorkInProgress({ status: "open", peer, claim: { active: false, since: null, workrooms: 0 } })).toBe(false);
    expect(peerWorkInProgress({ status: "in-progress", peer: null, claim: null })).toBe(false);
  });
});

describe("claimFromMirrorPayload", () => {
  it("reads a well-formed claim and tolerates a peer that sends none", () => {
    expect(claimFromMirrorPayload({ claim: { active: true, since: null, workrooms: 2 } })).toEqual({ active: true, since: null, workrooms: 2 });
    expect(claimFromMirrorPayload({ title: "x", status: "open" })).toBeNull();
    expect(claimFromMirrorPayload({ claim: { active: "yes" } })).toBeNull();
  });
});

describe("loadFederatedTwins", () => {
  it("queries open rows by marker and attaches the mirror's stored claim", async () => {
    const db = {
      backlogItem: { findMany: vi.fn().mockResolvedValue([local(), mirror()]) },
      federatedRecordMirror: {
        findMany: vi.fn().mockResolvedValue([{ localRecordRef: "BI-PEER", payload: { claim: { active: true, since: null, workrooms: 1 } } }]),
      },
    };
    const twins = await loadFederatedTwins(db, local());
    expect(db.backlogItem.findMany).toHaveBeenCalledWith({
      where: { status: { notIn: ["done", "retired", "deferred"] }, OR: [{ body: { contains: MARKER } }] },
      select: { id: true, itemId: true, status: true, body: true },
    });
    expect(twins).toHaveLength(1);
    expect(twins[0]!.claim?.active).toBe(true);
  });

  it("does not query for an item with no intake marker", async () => {
    const db = { backlogItem: { findMany: vi.fn() }, federatedRecordMirror: { findMany: vi.fn() } };
    expect(await loadFederatedTwins(db, local({ body: "no provenance" }))).toEqual([]);
    expect(db.backlogItem.findMany).not.toHaveBeenCalled();
  });
});

describe("recordFederatedTwins (AC-2)", () => {
  const now = new Date("2026-10-28T02:00:00.000Z");

  it("writes one twin activity on the local item per mirror, and none on a second pass", async () => {
    const activities: Array<{ backlogItemId: string; payload: unknown }> = [];
    const db = {
      backlogItem: { findMany: vi.fn().mockResolvedValue([local(), mirror()]) },
      backlogItemActivity: {
        findMany: vi.fn(async () => activities.map((a) => ({ backlogItemId: a.backlogItemId, payload: a.payload }))),
        create: vi.fn(async ({ data }: { data: { backlogItemId: string; payload: unknown } }) => { activities.push(data); }),
      },
    };
    const mirrors = [{ itemId: "BI-PEER", peerStatus: "in-progress", body: mirror().body }];

    expect(await recordFederatedTwins(db, mirrors, now)).toBe(1);
    expect(db.backlogItemActivity.create).toHaveBeenCalledWith({
      data: {
        backlogItemId: "row-local",
        kind: "federated_twin",
        summary: "Same defect is tracked on the paired installation as BI-PEER (in-progress)",
        payload: { peerInstallationId: PEER, peerItemId: "BI-PEER", peerStatus: "in-progress", marker: MARKER, observedAt: now.toISOString() },
      },
    });
    expect(await recordFederatedTwins(db, mirrors, now)).toBe(0);
  });

  it("never writes on a mirror and skips mirrors without an intake marker", async () => {
    const db = {
      backlogItem: { findMany: vi.fn().mockResolvedValue([mirror()]) },
      backlogItemActivity: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
    };
    expect(await recordFederatedTwins(db, [{ itemId: "BI-PEER", peerStatus: "open", body: mirror().body }], now)).toBe(0);
    expect(await recordFederatedTwins(db, [{ itemId: "BI-X", peerStatus: "open", body: `[origin:federatedWork:${PEER}:BI-X]` }], now)).toBe(0);
    expect(db.backlogItemActivity.create).not.toHaveBeenCalled();
  });
});
