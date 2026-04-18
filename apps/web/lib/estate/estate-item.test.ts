import { describe, expect, it } from "vitest";

import { createEstateItem } from "@/lib/estate/estate-item";

describe("createEstateItem", () => {
  it("prefers normalized estate fields when they are present", () => {
    const now = new Date();
    const item = createEstateItem({
      id: "entity-1",
      entityKey: "gateway:unifi-gateway",
      name: "Main Gateway",
      entityType: "gateway",
      technicalClass: "network_gateway",
      iconKey: "gateway",
      manufacturer: "Ubiquiti",
      productModel: "Dream Machine Pro",
      observedVersion: "4.0.2",
      normalizedVersion: "4.0.2",
      supportStatus: "supported",
      providerView: "foundational",
      status: "active",
      firstSeenAt: new Date(now.getTime() - (14 * 24 * 60 * 60 * 1000)),
      lastSeenAt: new Date(now.getTime() - (2 * 60 * 60 * 1000)),
      attributionStatus: "mapped",
      attributionConfidence: 0.94,
      taxonomyNode: { name: "Connectivity", nodeId: "foundational/connectivity/network" },
      _count: { fromRelationships: 2, toRelationships: 5 },
      qualityIssues: [
        { issueType: "gateway_connection_needed", severity: "warn", status: "open" },
        { issueType: "health_alert", severity: "error", status: "open" },
      ],
      softwareEvidence: [
        {
          rawVendor: "Ubiquiti",
          rawProductName: "UniFi Dream Machine Pro",
          rawPackageName: "unifi-dream-machine-pro",
          rawVersion: "4.0.2",
          normalizationStatus: "normalized",
          normalizationConfidence: 0.96,
          lastSeenAt: new Date(now.getTime() - (60 * 60 * 1000)),
        },
      ],
    });

    expect(item.iconKey).toBe("gateway");
    expect(item.technicalClassLabel).toBe("Network Gateway");
    expect(item.manufacturerLabel).toBe("Ubiquiti");
    expect(item.modelLabel).toBe("Dream Machine Pro");
    expect(item.identityLabel).toBe("Dream Machine Pro");
    expect(item.identityConfidenceLabel).toBe("Normalized identity");
    expect(item.versionLabel).toBe("4.0.2");
    expect(item.versionSourceLabel).toBe("Normalized from software evidence");
    expect(item.supportStatusLabel).toBe("Supported");
    expect(item.supportSummaryLabel).toBe("Covered by vendor support");
    expect(item.advisorySummaryLabel).toBe("No advisory findings recorded");
    expect(item.upstreamCount).toBe(2);
    expect(item.downstreamCount).toBe(5);
    expect(item.taxonomyPath).toBe("foundational / connectivity / network");
    expect(item.versionConfidenceLabel).toBe("High confidence version");
    expect(item.freshnessLabel).toBe("Seen recently");
    expect(item.blastRadiusLabel).toBe("Failure impacts 5 downstream dependencies");
    expect(item.postureBadges.map((badge) => badge.label)).toEqual([
      "1 dependency gap",
      "1 active alert",
    ]);
    expect(item.openIssueCount).toBe(2);
  });

  it("falls back to discovery evidence when normalized fields are missing", () => {
    const now = new Date();
    const item = createEstateItem({
      id: "entity-2",
      entityKey: "camera:lobby-cam",
      name: "Lobby Camera",
      entityType: "camera",
      technicalClass: null,
      iconKey: null,
      manufacturer: null,
      productModel: null,
      observedVersion: null,
      normalizedVersion: null,
      supportStatus: null,
      providerView: null,
      status: "active",
      firstSeenAt: new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000)),
      lastSeenAt: new Date(now.getTime() - (65 * 24 * 60 * 60 * 1000)),
      attributionStatus: "needs_review",
      attributionConfidence: 0.42,
      taxonomyNode: null,
      _count: { fromRelationships: 0, toRelationships: 1 },
      qualityIssues: [
        { issueType: "attribution_missing", severity: "warn", status: "open" },
        { issueType: "stale_entity", severity: "warn", status: "open" },
      ],
      softwareEvidence: [
        {
          rawVendor: "Axis",
          rawProductName: "Axis M1054",
          rawPackageName: "axis-m1054",
          rawVersion: "11.8.42",
          normalizationStatus: "raw_only",
          normalizationConfidence: 0.33,
          lastSeenAt: new Date(now.getTime() - (65 * 24 * 60 * 60 * 1000)),
        },
      ],
    });

    expect(item.iconKey).toBe("camera");
    expect(item.technicalClassLabel).toBe("Camera");
    expect(item.manufacturerLabel).toBe("Axis");
    expect(item.identityLabel).toBe("Axis M1054");
    expect(item.identityConfidenceLabel).toBe("Observed identity");
    expect(item.versionLabel).toBe("11.8.42");
    expect(item.versionSourceLabel).toBe("Observed from discovery evidence");
    expect(item.supportStatusLabel).toBe("Unknown");
    expect(item.supportSummaryLabel).toBe("Vendor lifecycle not verified");
    expect(item.advisorySummaryLabel).toBe("No advisory findings recorded");
    expect(item.providerViewLabel).toBe("Unassigned");
    expect(item.versionConfidenceLabel).toBe("Observed version only");
    expect(item.freshnessLabel).toBe("Stale evidence");
    expect(item.blastRadiusLabel).toBe("Failure impacts 1 downstream dependency");
    expect(item.postureBadges.map((badge) => badge.label)).toEqual([
      "1 attribution gap",
      "1 stale signal",
    ]);
    expect(item.openIssueCount).toBe(2);
  });

  it("surfaces lifecycle and advisory posture from open estate issues", () => {
    const item = createEstateItem({
      id: "entity-3",
      entityKey: "container:dpf-postgres",
      name: "dpf-postgres-1",
      entityType: "container",
      technicalClass: "container",
      manufacturer: null,
      productModel: null,
      observedVersion: null,
      normalizedVersion: null,
      supportStatus: "unknown",
      providerView: "foundational",
      status: "active",
      softwareEvidence: [
        {
          rawVendor: "postgres",
          rawProductName: "postgres:16-alpine",
          rawPackageName: "postgres:16-alpine",
          rawVersion: null,
          normalizationStatus: "needs_review",
          normalizationConfidence: 0.22,
          lastSeenAt: new Date(),
        },
      ],
      qualityIssues: [
        { issueType: "support_review_needed", severity: "warn", status: "open" },
        { issueType: "cve_detected", severity: "error", status: "open" },
      ],
      _count: { fromRelationships: 1, toRelationships: 2 },
    });

    expect(item.iconKey).toBe("container");
    expect(item.identityLabel).toBe("postgres:16-alpine");
    expect(item.identityConfidenceLabel).toBe("Identity needs review");
    expect(item.supportSummaryLabel).toBe("Support review needed");
    expect(item.advisorySummaryLabel).toBe("1 security finding recorded");
    expect(item.postureBadges.map((badge) => badge.label)).toEqual([
      "1 security finding",
      "1 support risk",
    ]);
  });
});
