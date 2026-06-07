import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyDppmPortfolio,
  DPPM_PORTFOLIOS,
  FOUNDATIONAL_NODES,
  placeableDeviceClasses,
  placeDeviceClass,
} from "./device-placement";
import { AUTO_PROMOTE_THRESHOLD } from "./discovery-promotion-policy";

// Mirrors the slugify + nodeId construction in seed.ts so the test proves the
// placement target ids match the LIVE taxonomy, not a stale copy.
function buildTaxonomyNodeIds(): Set<string> {
  const raw = readFileSync(join(__dirname, "..", "data", "taxonomy_v3.json"), "utf8");
  const rows = JSON.parse(raw) as Array<{
    portfolio_id: string;
    level_1: string;
    level_2: string;
    level_3: string;
  }>;
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const ids = new Set<string>();
  for (const row of rows) {
    const pid = row.portfolio_id;
    if (!pid) continue;
    ids.add(pid);
    if (!row.level_1) continue;
    const l1 = `${pid}/${slugify(row.level_1)}`;
    ids.add(l1);
    if (!row.level_2) continue;
    const l2 = `${l1}/${slugify(row.level_2)}`;
    ids.add(l2);
    if (!row.level_3) continue;
    ids.add(`${l2}/${slugify(row.level_3)}`);
  }
  return ids;
}

describe("classifyDppmPortfolio — the four-portfolio test", () => {
  it("sold products → Provided Externally", () => {
    expect(classifyDppmPortfolio({ delivery: "sold_product", consumer: "external_customer" })).toBe(
      "providedExternally",
    );
    expect(DPPM_PORTFOLIOS.providedExternally).toBe("products_and_services_sold");
  });

  it("employee-job software → Provided Internally", () => {
    expect(classifyDppmPortfolio({ delivery: "employee_app", consumer: "internal_employee" })).toBe(
      "providedInternally",
    );
    expect(DPPM_PORTFOLIOS.providedInternally).toBe("for_employees");
  });

  it("production OT → Manufacture & Delivery", () => {
    expect(classifyDppmPortfolio({ delivery: "production_ot", consumer: "production_line" })).toBe(
      "manufactureAndDelivery",
    );
    expect(DPPM_PORTFOLIOS.manufactureAndDelivery).toBe("manufacturing_and_delivery");
  });

  it("network / client compute / building management / IaaS → Foundational", () => {
    expect(classifyDppmPortfolio({ delivery: "device", consumer: "infrastructure" })).toBe("foundational");
    expect(DPPM_PORTFOLIOS.foundational).toBe("foundational");
  });
});

describe("placeDeviceClass — device class → Foundational sub-portfolio node", () => {
  const cases: Array<[string, string]> = [
    // Security & Surveillance — Reolink / Hui-Zhou cameras, NVRs
    ["ip_camera", FOUNDATIONAL_NODES.securityAndSurveillance],
    ["nvr", FOUNDATIONAL_NODES.securityAndSurveillance],
    ["doorbell_camera", FOUNDATIONAL_NODES.securityAndSurveillance],
    // Climate — Nest thermostat
    ["thermostat", FOUNDATIONAL_NODES.climateControl],
    // Access — Chamberlain garage / smart locks
    ["garage_door_opener", FOUNDATIONAL_NODES.accessControl],
    ["smart_lock", FOUNDATIONAL_NODES.accessControl],
    // Lighting & Energy — TP-Link Kasa plugs/bulbs
    ["smart_plug", FOUNDATIONAL_NODES.lightingAndEnergy],
    ["smart_bulb", FOUNDATIONAL_NODES.lightingAndEnergy],
    // Connected Appliances — LG / Whirlpool
    ["refrigerator", FOUNDATIONAL_NODES.connectedAppliances],
    ["washer", FOUNDATIONAL_NODES.connectedAppliances],
    // Network — Ubiquiti
    ["gateway", FOUNDATIONAL_NODES.networkConnectivity],
    ["access_point", FOUNDATIONAL_NODES.networkConnectivity],
    ["switch", FOUNDATIONAL_NODES.networkConnectivity],
    // Voice — Amazon Echo
    ["voice_assistant", FOUNDATIONAL_NODES.voice],
    ["smart_speaker", FOUNDATIONAL_NODES.voice],
    // Client Compute — Apple / MSI / Intel / Samsung
    ["client_endpoint", FOUNDATIONAL_NODES.clientCompute],
    ["laptop", FOUNDATIONAL_NODES.clientCompute],
    ["phone", FOUNDATIONAL_NODES.clientCompute],
  ];

  it.each(cases)("places %s under %s", (deviceClass, expectedNode) => {
    const placement = placeDeviceClass(deviceClass);
    expect(placement.taxonomyNodeId).toBe(expectedNode);
    expect(placement.reason).toBe("mapped");
    expect(placement.portfolio).toBe("foundational");
    expect(placement.autoPlace).toBe(true);
    expect(placement.taxonomyConfidence).toBeGreaterThanOrEqual(AUTO_PROMOTE_THRESHOLD);
  });

  it("normalizes synonyms and casing/spacing to canonical classes", () => {
    expect(placeDeviceClass("Camera").taxonomyNodeId).toBe(FOUNDATIONAL_NODES.securityAndSurveillance);
    expect(placeDeviceClass("smart-thermostat").taxonomyNodeId).toBe(FOUNDATIONAL_NODES.climateControl);
    expect(placeDeviceClass("Echo").taxonomyNodeId).toBe(FOUNDATIONAL_NODES.voice);
    expect(placeDeviceClass("PC").taxonomyNodeId).toBe(FOUNDATIONAL_NODES.clientCompute);
  });

  it("returns null + unplaceable_class for an unknown class (escalates, never mis-places)", () => {
    const placement = placeDeviceClass("quantum_toaster");
    expect(placement.taxonomyNodeId).toBeNull();
    expect(placement.reason).toBe("unplaceable_class");
    expect(placement.autoPlace).toBe(false);
    expect(placement.taxonomyConfidence).toBe(0);
  });

  it("does not auto-place when confidence is below the promote threshold", () => {
    const placement = placeDeviceClass("ip_camera", { confidence: 0.5 });
    expect(placement.taxonomyNodeId).toBe(FOUNDATIONAL_NODES.securityAndSurveillance);
    expect(placement.autoPlace).toBe(false);
  });

  it("every placeable class resolves to a foundational node id", () => {
    for (const cls of placeableDeviceClasses()) {
      const placement = placeDeviceClass(cls);
      expect(placement.taxonomyNodeId).not.toBeNull();
      expect(placement.taxonomyNodeId!.startsWith("foundational/")).toBe(true);
    }
  });
});

describe("placement targets exist in the live taxonomy (drift guard)", () => {
  const taxonomyIds = buildTaxonomyNodeIds();

  it("every FOUNDATIONAL_NODES id is a real node in taxonomy_v3.json", () => {
    for (const [name, nodeId] of Object.entries(FOUNDATIONAL_NODES)) {
      expect(taxonomyIds.has(nodeId), `${name} → ${nodeId} missing from taxonomy_v3.json`).toBe(true);
    }
  });

  it("every device class places into an existing taxonomy node", () => {
    for (const cls of placeableDeviceClasses()) {
      const nodeId = placeDeviceClass(cls).taxonomyNodeId!;
      expect(taxonomyIds.has(nodeId), `${cls} → ${nodeId} missing from taxonomy_v3.json`).toBe(true);
    }
  });

  it("the four DPPM portfolio ids are real portfolio roots", () => {
    for (const portfolioId of Object.values(DPPM_PORTFOLIOS)) {
      expect(taxonomyIds.has(portfolioId), `${portfolioId} missing from taxonomy_v3.json`).toBe(true);
    }
  });
});
