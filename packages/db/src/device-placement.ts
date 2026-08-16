/**
 * DPPM placement algorithm — device class → Foundational sub-portfolio
 * taxonomyNodeId (spec §3b, §5.4, §8.2; BI-CA1688BB).
 *
 * The infrastructure to *promote* a discovered device into the digital-product
 * portfolio already exists (classifyEstateProvenance, AUTO_PROMOTE_THRESHOLD,
 * the structural type/name gates, the seeded taxonomy tree). What did NOT exist
 * is the placement *algorithm itself*: given a resolved device class, which
 * existing taxonomy node does it belong under? This module is that algorithm.
 *
 * Design constraints (architect-reviewed spec):
 *  - Placement resolves to an EXISTING `taxonomyNodeId` (the semantic nodeId
 *    string, e.g. "foundational/building_management/security_and_surveillance").
 *    We do NOT introduce a parallel {portfolio, taxonomyNode, productType}
 *    object — the taxonomy path already encodes portfolio → sub-portfolio →
 *    product type.
 *  - Confidence reuses the discovery-triage thresholds + AUTO_PROMOTE_THRESHOLD,
 *    not a parallel scale.
 *  - Built on taxonomy_v3.json node ids (verified 2026-06-04) +
 *    discovery-promotion-policy.ts.
 *
 * Pure and offline (spec §10): no DB, no network. The seed/runtime resolves the
 * returned nodeId string → the TaxonomyNode cuid FK.
 */

import { AUTO_PROMOTE_THRESHOLD } from "./discovery-promotion-policy";

/**
 * The four DPPM portfolios (The Open Group, "Digital Product Portfolio
 * Management" §4 + "The Shift to Digital Product"), mapped to the taxonomy_v3
 * `portfolio_id` slugs they correspond to. The classification test for each is
 * "what is delivered / who is the consumer":
 *
 *  - providedExternally   — products/services SOLD to customers.
 *  - providedInternally   — software that does an employee's job.
 *  - foundational         — the network, client compute, building management,
 *                           and IaaS the business runs ON. (Estate devices.)
 *  - manufactureAndDelivery — production / operational-technology systems.
 *
 * The estate (cameras, thermostats, plugs, appliances, network gear, endpoints)
 * is, by this test, Foundational: it is infrastructure the business runs on,
 * not something sold, an employee app, or production OT.
 */
export const DPPM_PORTFOLIOS = {
  providedExternally: "products_and_services_sold",
  providedInternally: "for_employees",
  foundational: "foundational",
  manufactureAndDelivery: "manufacturing_and_delivery",
} as const;

export type DppmPortfolioKey = keyof typeof DPPM_PORTFOLIOS;

/** What is being delivered + to whom — the DPPM classification test inputs. */
export type DppmClassificationInput = {
  /** "device" | "sold_product" | "employee_app" | "production_ot" | … */
  delivery: string;
  /** "infrastructure" | "external_customer" | "internal_employee" | "production_line" | … */
  consumer: string;
};

/**
 * Apply the DPPM "what is delivered / who is the consumer" test to pick one of
 * the four portfolios. Estate infrastructure → foundational.
 */
export function classifyDppmPortfolio(input: DppmClassificationInput): DppmPortfolioKey {
  const delivery = input.delivery.trim().toLowerCase();
  const consumer = input.consumer.trim().toLowerCase();

  if (consumer === "external_customer" || delivery === "sold_product") {
    return "providedExternally";
  }
  if (delivery === "production_ot" || consumer === "production_line") {
    return "manufactureAndDelivery";
  }
  if (delivery === "employee_app" || consumer === "internal_employee") {
    return "providedInternally";
  }
  // Network, client compute, building management, IaaS — the infrastructure the
  // business runs on. This is where the discovered estate lands.
  return "foundational";
}

// Foundational sub-portfolio taxonomy node ids (verified against
// packages/db/data/taxonomy_v3.json, slugify = lowercase, non-alphanumeric → "_").
export const FOUNDATIONAL_NODES = {
  securityAndSurveillance: "foundational/building_management/security_and_surveillance",
  climateControl: "foundational/building_management/climate_control",
  accessControl: "foundational/building_management/access_control",
  lightingAndEnergy: "foundational/building_management/lighting_and_energy_management",
  connectedAppliances: "foundational/building_management/connected_appliances",
  clientCompute: "foundational/compute/client_and_end_user_compute",
  networkConnectivity: "foundational/network_management/network_connectivity",
  voice: "foundational/network_management/voice",
  onlineStorage: "foundational/data_and_storage_management/online_storage",
} as const;

export type DevicePlacement = {
  /** The resolved device class that was placed. */
  deviceClass: string;
  /** Existing taxonomy nodeId string, or null when the class cannot be placed. */
  taxonomyNodeId: string | null;
  /** Reuses the triage / promotion confidence scale (0..1). */
  taxonomyConfidence: number;
  /** The DPPM portfolio this placement sits in (always foundational for the estate today). */
  portfolio: DppmPortfolioKey;
  /** True when taxonomyConfidence clears AUTO_PROMOTE_THRESHOLD — auto-place, no operator. */
  autoPlace: boolean;
  /** Machine-readable rationale: "mapped" | "unplaceable_class". */
  reason: "mapped" | "unplaceable_class";
};

/**
 * Canonical device-class → Foundational sub-portfolio node map. The class names
 * are the `deviceClass` values fingerprint rules resolve to (spec §5.3). Keep
 * these stable — seed rules and the hive catalog reference them.
 *
 * Confidence is deterministic for these mappings (a class implies exactly one
 * sub-portfolio), so it sits at the triage `deterministicAutoApply` band; the
 * overall auto-place gate still ALSO requires the rule's identityConfidence to
 * clear the bar, so a low-confidence identity will not auto-place even though
 * the class→node mapping is certain.
 */
const DEVICE_CLASS_NODE: Record<string, string> = {
  // Security & Surveillance
  ip_camera: FOUNDATIONAL_NODES.securityAndSurveillance,
  nvr: FOUNDATIONAL_NODES.securityAndSurveillance,
  dvr: FOUNDATIONAL_NODES.securityAndSurveillance,
  doorbell_camera: FOUNDATIONAL_NODES.securityAndSurveillance,
  security_camera: FOUNDATIONAL_NODES.securityAndSurveillance,
  alarm_panel: FOUNDATIONAL_NODES.securityAndSurveillance,
  motion_sensor: FOUNDATIONAL_NODES.securityAndSurveillance,
  // Climate Control
  thermostat: FOUNDATIONAL_NODES.climateControl,
  hvac_controller: FOUNDATIONAL_NODES.climateControl,
  climate_sensor: FOUNDATIONAL_NODES.climateControl,
  smart_vent: FOUNDATIONAL_NODES.climateControl,
  // Access Control
  smart_lock: FOUNDATIONAL_NODES.accessControl,
  garage_door_opener: FOUNDATIONAL_NODES.accessControl,
  gate_controller: FOUNDATIONAL_NODES.accessControl,
  access_controller: FOUNDATIONAL_NODES.accessControl,
  // Lighting & Energy Management
  smart_plug: FOUNDATIONAL_NODES.lightingAndEnergy,
  smart_bulb: FOUNDATIONAL_NODES.lightingAndEnergy,
  light_switch: FOUNDATIONAL_NODES.lightingAndEnergy,
  energy_monitor: FOUNDATIONAL_NODES.lightingAndEnergy,
  smart_outlet: FOUNDATIONAL_NODES.lightingAndEnergy,
  // Connected Appliances
  smart_appliance: FOUNDATIONAL_NODES.connectedAppliances,
  refrigerator: FOUNDATIONAL_NODES.connectedAppliances,
  washer: FOUNDATIONAL_NODES.connectedAppliances,
  dryer: FOUNDATIONAL_NODES.connectedAppliances,
  oven: FOUNDATIONAL_NODES.connectedAppliances,
  dishwasher: FOUNDATIONAL_NODES.connectedAppliances,
  // Network Connectivity
  gateway: FOUNDATIONAL_NODES.networkConnectivity,
  router: FOUNDATIONAL_NODES.networkConnectivity,
  switch: FOUNDATIONAL_NODES.networkConnectivity,
  access_point: FOUNDATIONAL_NODES.networkConnectivity,
  network_controller: FOUNDATIONAL_NODES.networkConnectivity,
  firewall: FOUNDATIONAL_NODES.networkConnectivity,
  // Voice
  voice_assistant: FOUNDATIONAL_NODES.voice,
  smart_speaker: FOUNDATIONAL_NODES.voice,
  // Client & End User Compute
  client_endpoint: FOUNDATIONAL_NODES.clientCompute,
  laptop: FOUNDATIONAL_NODES.clientCompute,
  desktop: FOUNDATIONAL_NODES.clientCompute,
  workstation: FOUNDATIONAL_NODES.clientCompute,
  phone: FOUNDATIONAL_NODES.clientCompute,
  tablet: FOUNDATIONAL_NODES.clientCompute,
  printer: FOUNDATIONAL_NODES.clientCompute,
  nas: FOUNDATIONAL_NODES.onlineStorage,
};

/** Synonyms → canonical device-class keys, so rules can use natural names. */
const DEVICE_CLASS_ALIASES: Record<string, string> = {
  camera: "ip_camera",
  webcam: "ip_camera",
  smart_thermostat: "thermostat",
  thermostat_controller: "thermostat",
  plug: "smart_plug",
  outlet: "smart_outlet",
  bulb: "smart_bulb",
  lock: "smart_lock",
  speaker: "smart_speaker",
  echo: "voice_assistant",
  computer: "client_endpoint",
  pc: "client_endpoint",
  mobile: "phone",
  smartphone: "phone",
  ap: "access_point",
  wifi_router: "router",
};

const DEFAULT_PLACEMENT_CONFIDENCE = 0.97;

function canonicalDeviceClass(deviceClass: string): string {
  const key = deviceClass.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return DEVICE_CLASS_ALIASES[key] ?? key;
}

/**
 * Place a resolved device class into its Foundational sub-portfolio.
 *
 * Returns `taxonomyNodeId: null` + `reason: "unplaceable_class"` when the class
 * is not in the map — the layer-1 coworker (BI-4FACD527) handles those, and an
 * unplaceable class never silently lands in the wrong portfolio.
 */
export function placeDeviceClass(
  deviceClass: string,
  options: { confidence?: number } = {},
): DevicePlacement {
  const canonical = canonicalDeviceClass(deviceClass);
  const nodeId = DEVICE_CLASS_NODE[canonical] ?? null;

  if (nodeId === null) {
    return {
      deviceClass: canonical,
      taxonomyNodeId: null,
      taxonomyConfidence: 0,
      portfolio: "foundational",
      autoPlace: false,
      reason: "unplaceable_class",
    };
  }

  const taxonomyConfidence = clamp01(options.confidence ?? DEFAULT_PLACEMENT_CONFIDENCE);
  return {
    deviceClass: canonical,
    taxonomyNodeId: nodeId,
    taxonomyConfidence,
    portfolio: "foundational",
    autoPlace: taxonomyConfidence >= AUTO_PROMOTE_THRESHOLD,
    reason: "mapped",
  };
}

/** Every device class the algorithm can place (canonical keys). */
export function placeableDeviceClasses(): string[] {
  return Object.keys(DEVICE_CLASS_NODE);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
