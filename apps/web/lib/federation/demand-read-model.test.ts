import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { mapDemandShareTargets, mapNetworkDemandRows } from "./demand-read-model";

describe("mapDemandShareTargets", () => {
  it("offers only cross-company upstream destinations and leaves same-company peers on automatic sync", () => {
    const targets = mapDemandShareTargets([
      { linkId: "FL-DISTRIBUTOR", role: "managed-by", peerInstallationId: "inst_distributor", principal: { displayName: "Reseller One" } },
      { linkId: "FL-FOUNDER", role: "channel-downstream", peerInstallationId: "inst_founder", principal: { displayName: "Central Founder Hub" } },
      { linkId: "FL-CUSTOMER", role: "manages", peerInstallationId: "inst_customer", principal: { displayName: "Customer One" } },
      { linkId: "FL-DOWNSTREAM", role: "channel-upstream", peerInstallationId: "inst_reseller", principal: { displayName: "Reseller Two" } },
      { linkId: "FL-INTERNAL", role: "same-org-peer", peerInstallationId: "inst_internal", principal: { displayName: "Windows Test" } },
    ], new Map([
      ["FL-DISTRIBUTOR", ["BI-LOCAL"]],
      ["FL-CUSTOMER", ["BI-REVERSE"]],
    ]));

    expect(targets).toEqual([
      {
        linkId: "FL-DISTRIBUTOR",
        displayName: "Reseller One",
        role: "managed-by",
        destinationKind: "distributor",
        sharedItemIds: ["BI-LOCAL"],
      },
      {
        linkId: "FL-FOUNDER",
        displayName: "Central Founder Hub",
        role: "channel-downstream",
        destinationKind: "founder-hub",
        sharedItemIds: [],
      },
    ]);
  });
});

describe("mapNetworkDemandRows", () => {
  it("returns share-safe display fields without peer identity or route details", () => {
    const rows = mapNetworkDemandRows([{
      mirrorId: "fdm_1",
      syncStatus: "synced",
      version: 2n,
      localRecordRef: null,
      lastSyncedAt: new Date("2026-07-20T05:10:00.000Z"),
      payload: {
        activity: "dpf.demand.updated",
        disposition: "followed",
        receivedAt: "2026-07-20T05:10:00.000Z",
        envelope: {
          specVersion: "dpf.demand/1",
          envelopeId: "dem_1",
          originInstallationId: "private-install-id",
          originRecordRef: "private-record-ref",
          originVersion: 2,
          route: [{ installationId: "private-hop", relationshipKind: "channel", receivedAt: "2026-07-20T05:00:00.000Z", attestationDigest: "private" }],
          audience: "partner",
          title: "Shared improvement",
          summary: "A safe summary",
          workType: "feature",
          signal: { occurrenceCount: 4, affectedOrganizations: 2 },
          attribution: "pseudonymous",
          createdAt: "2026-07-20T05:00:00.000Z",
          updatedAt: "2026-07-20T05:10:00.000Z",
          payloadDigest: "sha256:v2",
        },
      },
    }]);

    expect(rows).toEqual([{
      mirrorId: "fdm_1",
      title: "Shared improvement",
      summary: "A safe summary",
      workType: "feature",
      attribution: "pseudonymous",
      occurrenceCount: 4,
      affectedOrganizations: 2,
      disposition: "followed",
      syncStatus: "synced",
      originVersion: 2,
      updatedAt: "2026-07-20T05:10:00.000Z",
      localItemId: null,
      forwardingToFounderPermitted: false,
      forwardingExpiresAt: null,
    }]);
    expect(JSON.stringify(rows)).not.toContain("private-install-id");
    expect(JSON.stringify(rows)).not.toContain("private-record-ref");
    expect(JSON.stringify(rows)).not.toContain("private-hop");
  });

  it("drops malformed mirror payloads rather than breaking Delivery Flow", () => {
    expect(mapNetworkDemandRows([{
      mirrorId: "bad",
      syncStatus: "conflict",
      version: 1n,
      localRecordRef: null,
      lastSyncedAt: null,
      payload: { nope: true },
    }])).toEqual([]);
  });
});
