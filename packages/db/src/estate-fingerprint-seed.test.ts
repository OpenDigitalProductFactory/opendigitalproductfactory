import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { placeDeviceClass } from "./device-placement";
import { normalizeDiscoveredFacts } from "./discovery-normalize";
import type { CollectorOutput } from "./discovery-types";
import type { AdapterRule } from "./discovery-fingerprint-adapter";
import {
  loadFingerprintCatalogIntoDb,
  defaultCatalogPath,
  type FingerprintCatalogLoaderClient,
} from "./discovery-fingerprint-catalog-loader";

type SeedRule = {
  ruleKey: string;
  matchExpression: AdapterRule["matchExpression"];
  requiredEvidenceFamilies: string[];
  resolvedIdentity: { name: string; vendor?: string; deviceClass?: string };
  taxonomyNodeId: string;
  identityConfidence: number;
  taxonomyConfidence: number;
};

function loadEstateRules(): SeedRule[] {
  const raw = readFileSync(
    join(__dirname, "..", "data", "discovery_fingerprints", "rules", "estate-foundational-devices.json"),
    "utf8",
  );
  return JSON.parse(raw) as SeedRule[];
}

describe("estate seed rules ↔ DPPM placement algorithm consistency", () => {
  const rules = loadEstateRules();

  it("every seed rule's taxonomyNodeId equals placeDeviceClass(deviceClass)", () => {
    for (const rule of rules) {
      const deviceClass = rule.resolvedIdentity.deviceClass!;
      const placement = placeDeviceClass(deviceClass);
      expect(placement.taxonomyNodeId, `${rule.ruleKey} (${deviceClass})`).toBe(rule.taxonomyNodeId);
    }
  });

  it("every seed rule auto-applies (both confidences clear the promote threshold)", () => {
    for (const rule of rules) {
      expect(Math.min(rule.identityConfidence, rule.taxonomyConfidence), rule.ruleKey).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("covers every observed estate vendor group", () => {
    const nodes = new Set(rules.map((r) => r.taxonomyNodeId));
    expect(nodes).toEqual(
      new Set([
        "foundational/building_management/security_and_surveillance",
        "foundational/building_management/climate_control",
        "foundational/building_management/access_control",
        "foundational/building_management/lighting_and_energy_management",
        "foundational/building_management/connected_appliances",
        "foundational/network_management/voice",
        "foundational/network_management/network_connectivity",
        "foundational/compute/client_and_end_user_compute",
      ]),
    );
  });
});

describe("discovery normalization applies fingerprint rules (layer 0)", () => {
  // A Reolink rule as it would be loaded from the DB (taxonomyNodeId = nodeId string).
  const reolinkRule: AdapterRule = {
    id: "rule_reolink",
    ruleKey: "estate:reolink-camera",
    status: "active",
    matchExpression: { all: [{ type: "contains", path: "vendor", value: "reolink" }] },
    requiredEvidenceFamilies: ["mac_oui"],
    taxonomyNodeId: "foundational/building_management/security_and_surveillance",
    identityConfidence: 0.96,
    taxonomyConfidence: 0.96,
    resolvedIdentity: { kind: "device", name: "Reolink IP camera / NVR", vendor: "Reolink", deviceClass: "ip_camera" },
  };

  function reolinkItem(): CollectorOutput {
    return {
      items: [
        {
          sourceKind: "unifi",
          itemType: "network_client",
          name: "Reolink 192.168.0.42",
          externalRef: "arp:192.168.0.42",
          attributes: { vendor: "Reolink", vendorShort: "Reolink", mac: "ec:71:db:11:22:33", discoveredVia: "unifi" },
        },
      ],
      relationships: [],
    };
  }

  it("identifies + places a matching device deterministically, overriding the heuristic", () => {
    const out = normalizeDiscoveredFacts(reolinkItem(), { fingerprintRules: [reolinkRule] });
    const entity = out.inventoryEntities[0];
    expect(entity.taxonomyNodeId).toBe("foundational/building_management/security_and_surveillance");
    expect(entity.attributionStatus).toBe("attributed");
    expect(entity.attributionMethod).toBe("rule");
    expect(entity.attributionConfidence).toBeGreaterThanOrEqual(0.9);
    expect(entity.portfolioSlug).toBe("foundational");
    const ev = entity.attributionEvidence as Record<string, unknown>;
    expect(ev.source).toBe("discovery-fingerprint");
    expect(ev.ruleKey).toBe("estate:reolink-camera");
  });

  it("does NOT fingerprint-attribute a device no rule matches (falls through)", () => {
    const mysteryItem: CollectorOutput = {
        items: [
          {
            sourceKind: "unifi",
            itemType: "network_client",
            name: "MysteryThing 192.168.0.99",
            externalRef: "arp:192.168.0.99",
            attributes: { vendor: "Totally Unknown Vendor", mac: "aa:bb:cc:dd:ee:ff" },
          },
        ],
        relationships: [],
    };
    const out = normalizeDiscoveredFacts(mysteryItem, { fingerprintRules: [reolinkRule] });
    const entity = out.inventoryEntities[0];
    const ev = (entity.attributionEvidence ?? {}) as Record<string, unknown>;
    expect(ev.source).not.toBe("discovery-fingerprint");
  });

  it("does nothing when no fingerprint rules are supplied (back-compat)", () => {
    const out = normalizeDiscoveredFacts(reolinkItem(), {});
    const entity = out.inventoryEntities[0];
    const ev = (entity.attributionEvidence ?? {}) as Record<string, unknown>;
    expect(ev.source).not.toBe("discovery-fingerprint");
  });
});

describe("loadFingerprintCatalogIntoDb", () => {
  it("upserts rules and resolves the semantic nodeId to a TaxonomyNode cuid", async () => {
    const upsertedRules: Array<Record<string, unknown>> = [];
    const client: FingerprintCatalogLoaderClient = {
      taxonomyNode: {
        findMany: async () => [
          { id: "cuid_security", nodeId: "foundational/building_management/security_and_surveillance" },
          { id: "cuid_voice", nodeId: "foundational/network_management/voice" },
          { id: "cuid_climate", nodeId: "foundational/building_management/climate_control" },
          { id: "cuid_access", nodeId: "foundational/building_management/access_control" },
          { id: "cuid_lighting", nodeId: "foundational/building_management/lighting_and_energy_management" },
          { id: "cuid_appliances", nodeId: "foundational/building_management/connected_appliances" },
          { id: "cuid_network", nodeId: "foundational/network_management/network_connectivity" },
          { id: "cuid_client", nodeId: "foundational/compute/client_and_end_user_compute" },
        ],
      },
      discoveryFingerprintCatalogVersion: {
        upsert: async () => ({ id: "catver_1" }),
      },
      discoveryFingerprintRule: {
        upsert: async (args: unknown) => {
          upsertedRules.push((args as { create: Record<string, unknown> }).create);
          return {};
        },
      },
      catalogIdentity: {
        upsert: async () => ({ id: "catalog_identity_1" }),
      },
    };

    const result = await loadFingerprintCatalogIntoDb(client, defaultCatalogPath(__dirname));

    // 1 observability rule + 13 estate rules.
    expect(result.loaded).toBe(14);
    expect(result.unresolvedTaxonomy).toContain("observability:prometheus-node-exporter -> platform.observability.metrics");
    const reolink = upsertedRules.find((r) => r.ruleKey === "estate:reolink-camera");
    expect(reolink).toBeDefined();
    expect(reolink!.taxonomyNodeId).toBe("cuid_security");
    expect(reolink!.status).toBe("active");
    expect(reolink!.source).toBe("seed");
  });
});
