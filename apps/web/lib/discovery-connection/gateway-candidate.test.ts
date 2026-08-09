import { describe, expect, it } from "vitest";

import {
  buildGatewayCandidates,
  choosePreselectedGateway,
  gatewayConnectionAddresses,
  gatewayEvidenceWhere,
} from "./gateway-candidate";

const unifiGateway = {
  id: "gw-unifi",
  entityKey: "unifi:aa:bb:cc:dd:ee:ff",
  name: "Cloud Gateway Ultra",
  manufacturer: "Ubiquiti",
  productModel: "UCG-Ultra",
  confidence: 0.96,
  properties: { address: "192.168.0.1", discoveredVia: "unifi_api" },
};

describe("buildGatewayCandidates", () => {
  it("identifies a UniFi gateway and carries identity evidence separately from its address", () => {
    expect(buildGatewayCandidates([unifiGateway], "192.168.0.1")).toEqual([
      expect.objectContaining({
        entityId: "gw-unifi",
        name: "Cloud Gateway Ultra",
        address: "192.168.0.1",
        manufacturer: "Ubiquiti",
        model: "UCG-Ultra",
        recommendedCollector: "unifi",
        canonicalEndpoint: "https://192.168.0.1",
        matchesDetectedGateway: true,
        usable: true,
      }),
    ]);
  });

  it("uses enriched property evidence when canonical identity columns are not populated yet", () => {
    const [candidate] = buildGatewayCandidates([{
      ...unifiGateway,
      manufacturer: null,
      productModel: null,
      properties: {
        address: "192.168.0.1",
        vendor: "Ubiquiti Networks",
        modelName: "UniFi Dream Machine Pro",
        sourceKind: "arp_oui_enrichment",
      },
    }], null);

    expect(candidate).toMatchObject({
      manufacturer: "Ubiquiti Networks",
      model: "UniFi Dream Machine Pro",
      recommendedCollector: "unifi",
    });
    expect(candidate.evidence.join(" ")).toMatch(/Ubiquiti Networks.*UniFi Dream Machine Pro/i);
  });

  it("keeps an unidentified gateway usable through the generic scan without calling it UniFi", () => {
    const [candidate] = buildGatewayCandidates([{
      id: "gw-generic",
      entityKey: "arp:192.168.5.1",
      name: "Gateway 192.168.5.1",
      manufacturer: null,
      productModel: null,
      confidence: 0.65,
      properties: { address: "192.168.5.1" },
    }], null);

    expect(candidate).toMatchObject({
      recommendedCollector: "arp_scan",
      canonicalEndpoint: "192.168.5.0/24",
      usable: true,
    });
    expect(candidate.evidence.join(" ")).not.toMatch(/UniFi/i);
  });

  it("recommends SNMP only when discovery evidence explicitly supports it", () => {
    const [candidate] = buildGatewayCandidates([{
      id: "gw-snmp",
      entityKey: "snmp:192.168.8.1",
      name: "Core Router",
      manufacturer: "Cisco",
      productModel: "ISR",
      confidence: 0.9,
      properties: { address: "192.168.8.1", sysObjectId: "1.3.6.1.4.1.9" },
    }], null);

    expect(candidate).toMatchObject({
      recommendedCollector: "snmp",
      canonicalEndpoint: "192.168.8.1",
    });
  });

  it("retains candidates without an address but marks them unavailable for setup", () => {
    const [candidate] = buildGatewayCandidates([{
      ...unifiGateway,
      id: "gw-no-address",
      properties: {},
    }], null);

    expect(candidate).toMatchObject({ usable: false, canonicalEndpoint: null });
  });

  it("collapses generic route and enriched device records for the same physical gateway", () => {
    const candidates = buildGatewayCandidates([
      {
        id: "gw-route",
        entityKey: "gateway:192.168.0.1",
        name: "Gateway 192.168.0.1",
        manufacturer: null,
        productModel: null,
        confidence: 0.9,
        properties: { address: "192.168.0.1", discoveredVia: "default_route" },
      },
      unifiGateway,
    ], "192.168.0.1");

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      entityId: "gw-unifi",
      name: "Cloud Gateway Ultra",
      manufacturer: "Ubiquiti",
      model: "UCG-Ultra",
      recommendedCollector: "unifi",
      matchesDetectedGateway: true,
    });
    expect(candidates[0].evidence.join(" ")).toMatch(/default_route/i);
  });

  it("promotes a physical host when a tested UniFi connection targets the same address", () => {
    const candidates = buildGatewayCandidates([{
      id: "physical-host",
      entityKey: "host:arp:192.168.0.1",
      name: "LAN Host 192.168.0.1",
      manufacturer: null,
      productModel: null,
      confidence: 0.7,
      properties: { address: "192.168.0.1", discoveredVia: "arp_scan" },
    }], null, [{
      collectorType: "unifi",
      endpointUrl: "https://192.168.0.1",
      status: "active",
    }]);

    expect(candidates).toEqual([
      expect.objectContaining({
        entityId: "physical-host",
        name: "UniFi gateway 192.168.0.1",
        address: "192.168.0.1",
        recommendedCollector: "unifi",
        canonicalEndpoint: "https://192.168.0.1",
        matchesDetectedGateway: true,
      }),
    ]);
    expect(candidates[0].evidence.join(" ")).toMatch(/active UniFi connection/i);
  });

  it("does not promote unrelated hosts from connection evidence", () => {
    const candidates = buildGatewayCandidates([{
      id: "other-host",
      entityKey: "host:arp:192.168.0.42",
      name: "LAN Host 192.168.0.42",
      manufacturer: null,
      productModel: null,
      confidence: 0.7,
      properties: { address: "192.168.0.42" },
    }], null, [{
      collectorType: "unifi",
      endpointUrl: "https://192.168.0.1",
      status: "active",
    }]);

    expect(candidates[0]).toMatchObject({
      name: "LAN Host 192.168.0.42",
      recommendedCollector: "arp_scan",
      matchesDetectedGateway: false,
    });
  });
});

describe("gateway connection evidence query", () => {
  it("queries the physical host at an authoritative management target", () => {
    const addresses = gatewayConnectionAddresses([
      { collectorType: "unifi", endpointUrl: "https://192.168.0.1", status: "active" },
      { collectorType: "snmp", endpointUrl: "192.168.0.1", status: "unreachable" },
      { collectorType: "arp_scan", endpointUrl: "192.168.0.0/24", status: "active" },
    ]);

    expect(addresses).toEqual(["192.168.0.1"]);
    expect(gatewayEvidenceWhere(addresses)).toEqual({
      OR: [
        { entityType: { in: ["gateway", "router"] } },
        {
          entityType: "host",
          properties: { path: ["address"], equals: "192.168.0.1" },
        },
      ],
    });
  });
});

describe("choosePreselectedGateway", () => {
  it("preselects the one usable gateway", () => {
    const candidates = buildGatewayCandidates([unifiGateway], null);
    expect(choosePreselectedGateway(candidates)).toBe("gw-unifi");
  });

  it("preselects the sole candidate matching the observed default route", () => {
    const candidates = buildGatewayCandidates([
      unifiGateway,
      {
        ...unifiGateway,
        id: "gw-other",
        entityKey: "arp:192.168.9.1",
        name: "Other router",
        manufacturer: null,
        productModel: null,
        properties: { address: "192.168.9.1" },
      },
    ], "192.168.0.1");

    expect(choosePreselectedGateway(candidates)).toBe("gw-unifi");
  });

  it("requires a deliberate choice when multiple usable candidates are ambiguous", () => {
    const candidates = buildGatewayCandidates([
      unifiGateway,
      {
        ...unifiGateway,
        id: "gw-other",
        entityKey: "unifi:11:22:33:44:55:66",
        name: "Second Cloud Gateway",
        properties: { address: "192.168.9.1" },
      },
    ], null);

    expect(choosePreselectedGateway(candidates)).toBeNull();
  });
});
