import { describe, expect, it } from "vitest";

import { createEstateItem } from "@/lib/estate/estate-item";

describe("createEstateItem", () => {
  it("prefers normalized estate fields when they are present", () => {
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
      taxonomyNode: { name: "Connectivity", nodeId: "foundational/connectivity/network" },
      _count: { fromRelationships: 2, toRelationships: 5 },
      softwareEvidence: [],
    });

    expect(item.iconKey).toBe("gateway");
    expect(item.technicalClassLabel).toBe("Network Gateway");
    expect(item.manufacturerLabel).toBe("Ubiquiti");
    expect(item.modelLabel).toBe("Dream Machine Pro");
    expect(item.versionLabel).toBe("4.0.2");
    expect(item.supportStatusLabel).toBe("Supported");
    expect(item.upstreamCount).toBe(2);
    expect(item.downstreamCount).toBe(5);
    expect(item.taxonomyPath).toBe("foundational / connectivity / network");
  });

  it("falls back to discovery evidence when normalized fields are missing", () => {
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
      taxonomyNode: null,
      _count: { fromRelationships: 0, toRelationships: 1 },
      softwareEvidence: [
        { rawVendor: "Axis", rawVersion: "11.8.42" },
      ],
    });

    expect(item.iconKey).toBe("camera");
    expect(item.technicalClassLabel).toBe("Camera");
    expect(item.manufacturerLabel).toBe("Axis");
    expect(item.versionLabel).toBe("11.8.42");
    expect(item.supportStatusLabel).toBe("Unknown");
    expect(item.providerViewLabel).toBe("Unassigned");
  });
});
