import { describe, expect, it } from "vitest";

import {
  buildEnrichmentUpdate,
  canonicalizeVendor,
  deriveInventoryEnrichment,
  parseContainerImage,
  resolveIconKey,
} from "../src/inventory-enrichment";

function makeEntity(overrides: Partial<Parameters<typeof deriveInventoryEnrichment>[0]> = {}) {
  return {
    entityType: "host",
    name: "Generic-Host",
    manufacturer: null,
    productModel: null,
    observedVersion: null,
    normalizedVersion: null,
    iconKey: null,
    supportStatus: "unknown",
    properties: {},
    ...overrides,
  };
}

describe("canonicalizeVendor", () => {
  it("maps OUI strings to short brand names", () => {
    expect(canonicalizeVendor("Google, Inc.")).toBe("Google");
    expect(canonicalizeVendor("Nest Labs Inc.")).toBe("Nest");
    expect(canonicalizeVendor("Amazon Technologies Inc.")).toBe("Amazon");
    expect(canonicalizeVendor("Ubiquiti Networks")).toBe("Ubiquiti");
  });

  it("strips common corporate suffixes for unknown vendors", () => {
    expect(canonicalizeVendor("Acme Robotics Inc.")).toBe("Acme Robotics");
    expect(canonicalizeVendor("Foo Technologies")).toBe("Foo");
  });

  it("returns null for empty input", () => {
    expect(canonicalizeVendor(null)).toBeNull();
    expect(canonicalizeVendor("")).toBeNull();
    expect(canonicalizeVendor("   ")).toBeNull();
  });
});

describe("parseContainerImage", () => {
  it("splits an image into manufacturer + version", () => {
    expect(parseContainerImage("postgres:16-alpine")).toEqual({ manufacturer: "postgres", version: "16-alpine" });
    expect(parseContainerImage("neo4j:5-community")).toEqual({ manufacturer: "neo4j", version: "5-community" });
  });

  it("strips registry + namespace", () => {
    expect(parseContainerImage("ghcr.io/opendigitalproductfactory/dpf-edge-node:latest")).toEqual({
      manufacturer: "dpf-edge-node",
      version: "latest",
    });
  });

  it("handles missing tag", () => {
    expect(parseContainerImage("redis")).toEqual({ manufacturer: "redis", version: null });
  });

  it("does not treat registry port as a tag", () => {
    expect(parseContainerImage("registry:5000/team/app:1.2.3")).toEqual({
      manufacturer: "app",
      version: "1.2.3",
    });
  });
});

describe("resolveIconKey", () => {
  it("uses name patterns first", () => {
    expect(resolveIconKey({ entityType: "host", manufacturer: null, name: "Nest-Thermostat-3D8D", properties: {} }))
      .toBe("thermostat");
    expect(resolveIconKey({ entityType: "host", manufacturer: null, name: "Old-house-camera", properties: {} }))
      .toBe("camera");
    expect(resolveIconKey({ entityType: "host", manufacturer: null, name: "LG_Smart_Dryer2_open", properties: {} }))
      .toBe("appliance");
  });

  it("falls back to manufacturer hints", () => {
    expect(resolveIconKey({ entityType: "host", manufacturer: "Nest", name: "device-3d8d", properties: {} }))
      .toBe("thermostat");
    expect(resolveIconKey({ entityType: "access_point", manufacturer: "Ubiquiti", name: "U7 Pro", properties: {} }))
      .toBe("wifi");
  });

  it("falls back to entityType for structural items", () => {
    expect(resolveIconKey({ entityType: "subnet", manufacturer: null, name: "192.168.0.0/24", properties: {} }))
      .toBe("network");
    expect(resolveIconKey({ entityType: "database", manufacturer: null, name: "postgres", properties: {} }))
      .toBe("database");
    expect(resolveIconKey({ entityType: "container", manufacturer: null, name: "dpf-redis-1", properties: {} }))
      .toBe("container");
  });
});

describe("deriveInventoryEnrichment", () => {
  it("populates manufacturer + icon for a Nest thermostat from MAC OUI", () => {
    const result = deriveInventoryEnrichment(makeEntity({
      entityType: "host",
      name: "Nest-Thermostat-3D8D",
      properties: { vendor: "Google, Inc.", vendorShort: "Google", mac: "3c:31:74:e9:3d:8d" },
    }));

    expect(result.manufacturer).toBe("Google");
    expect(result.iconKey).toBe("thermostat");
    expect(result.supportStatus).toBe("supported");
    expect(result.changed).toBe(true);
  });

  it("populates manufacturer + version from container image", () => {
    const result = deriveInventoryEnrichment(makeEntity({
      entityType: "container",
      name: "dpf-postgres-1",
      properties: { image: "postgres:16-alpine", containerId: "abc123" },
    }));

    expect(result.manufacturer).toBe("postgres");
    expect(result.observedVersion).toBe("16-alpine");
    expect(result.normalizedVersion).toBe("16-alpine");
    expect(result.iconKey).toBe("container");
  });

  it("never overwrites an existing manufacturer", () => {
    const entity = makeEntity({
      manufacturer: "Original Vendor",
      properties: { vendor: "Google, Inc." },
    });

    const result = deriveInventoryEnrichment(entity);
    const update = buildEnrichmentUpdate(entity, result);

    expect(update?.manufacturer).toBeUndefined();
  });

  it("never downgrades supportStatus from a real value to unknown", () => {
    const entity = makeEntity({
      manufacturer: "Nest",
      supportStatus: "expired",
      properties: { vendor: "Nest Labs Inc." },
    });

    const result = deriveInventoryEnrichment(entity);
    expect(result.supportStatus).toBe("expired");
  });

  it("is idempotent: a second pass with the enriched values produces no update", () => {
    const entity = makeEntity({
      entityType: "host",
      name: "Nest-Thermostat-3D8D",
      properties: { vendor: "Google, Inc.", vendorShort: "Google" },
    });

    const first = deriveInventoryEnrichment(entity);
    const enriched = makeEntity({
      entityType: entity.entityType,
      name: entity.name,
      manufacturer: first.manufacturer,
      productModel: first.productModel,
      observedVersion: first.observedVersion,
      normalizedVersion: first.normalizedVersion,
      iconKey: first.iconKey,
      supportStatus: first.supportStatus,
      properties: entity.properties,
    });

    const update = buildEnrichmentUpdate(enriched, deriveInventoryEnrichment(enriched));
    expect(update).toBeNull();
  });
});
