import { describe, expect, it } from "vitest";

import { mapNetworkDemandRows } from "./demand-read-model";

describe("mapNetworkDemandRows", () => {
  it("returns share-safe display fields without peer identity or route details", () => {
    const rows = mapNetworkDemandRows([{
      mirrorId: "fdm_1",
      syncStatus: "synced",
      version: 2,
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
    }]);
    expect(JSON.stringify(rows)).not.toContain("private-install-id");
    expect(JSON.stringify(rows)).not.toContain("private-record-ref");
    expect(JSON.stringify(rows)).not.toContain("private-hop");
  });

  it("drops malformed mirror payloads rather than breaking Delivery Flow", () => {
    expect(mapNetworkDemandRows([{
      mirrorId: "bad",
      syncStatus: "conflict",
      version: 1,
      localRecordRef: null,
      lastSyncedAt: null,
      payload: { nope: true },
    }])).toEqual([]);
  });
});
