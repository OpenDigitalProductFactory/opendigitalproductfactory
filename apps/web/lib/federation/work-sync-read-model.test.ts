import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { mapWorkSyncLinks, parseWorkSyncHealthRecord } from "./work-sync-read-model";

const now = new Date("2026-09-02T21:00:00.000Z");
const links = [
  { linkId: "link_1", peerAuthorityUrl: "http://192.168.0.152:3000", principal: { displayName: "Production" } },
];

describe("mapWorkSyncLinks", () => {
  it("counts mirrors per link and carries the one health sentence", () => {
    const mirrors = [
      { federationLinkId: "link_1", recordType: "backlog-item", syncStatus: "synced", lastSyncedAt: new Date("2026-09-02T20:58:00.000Z") },
      { federationLinkId: "link_1", recordType: "backlog-item", syncStatus: "synced", lastSyncedAt: new Date("2026-09-02T20:58:00.000Z") },
      { federationLinkId: "link_1", recordType: "backlog-item", syncStatus: "conflict", lastSyncedAt: null },
      { federationLinkId: "link_1", recordType: "epic", syncStatus: "synced", lastSyncedAt: new Date("2026-09-02T20:58:00.000Z") },
    ];
    const health = { schemaVersion: 1 as const, observedAt: now.toISOString(), links: [{ linkId: "link_1", outcome: "synced" as const, detail: null, lastPullAt: now.toISOString() }] };
    const result = mapWorkSyncLinks(links, mirrors, health, now);
    expect(result.links[0]).toMatchObject({ mirroredItems: 2, mirroredEpics: 1, conflicts: 1, healthState: "in-step", lastOutcome: "synced" });
    expect(result.links[0]!.healthLine).toBe("In step with Production: 2 items mirrored here, last copy 2 minutes ago (1 id left alone because local work uses it).");
    expect(result.health.state).toBe("in-step");
  });

  it("says why a connection is broken from the runner's last recorded outcome", () => {
    const health = { schemaVersion: 1 as const, observedAt: now.toISOString(), links: [{ linkId: "link_1", outcome: "fetch-failed" as const, detail: "Peer does not serve work sync yet (upgrade the peer).", lastPullAt: null }] };
    const result = mapWorkSyncLinks(links, [], health, now);
    expect(result.health.state).toBe("broken");
    expect(result.links[0]!.healthLine).toMatch(/^Broken because the other installation is on a version that predates backlog sync/);
    expect(parseWorkSyncHealthRecord({ schemaVersion: 2 })).toBeNull();
    expect(parseWorkSyncHealthRecord(health)).toEqual(health);
  });

  it("has a line for no connections at all", () => {
    expect(mapWorkSyncLinks([], [], null, now).health).toMatchObject({ state: "no-peer" });
  });
});
