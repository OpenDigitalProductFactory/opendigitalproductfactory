// Post-discovery enrichment for InventoryEntity rows.
//
// Discovery adapters collect raw signals (MAC OUI vendor, container image,
// SSDP/mDNS announcements) into the `properties` JSON. The fields the UI
// reads — `manufacturer`, `productModel`, `observedVersion`, `iconKey`,
// `supportStatus` — were never populated from those signals, leaving every
// device card showing "Unknown vendor", "Unknown version", generic icon,
// and "unknown support posture".
//
// This module is the gap-closer. It is pure (no DB I/O) so it can be unit
// tested and called from both the live discovery sync path and a backfill
// script.

import type { Prisma } from "../generated/client/client";

import type { SupportStatus } from "./inventory-enrichment-types";

export type EnrichableEntity = {
  entityType: string;
  name: string;
  manufacturer: string | null;
  productModel: string | null;
  observedVersion: string | null;
  normalizedVersion: string | null;
  iconKey: string | null;
  supportStatus: string;
  properties: Prisma.JsonValue;
};

export type EnrichmentResult = {
  manufacturer: string | null;
  productModel: string | null;
  observedVersion: string | null;
  normalizedVersion: string | null;
  iconKey: string | null;
  supportStatus: SupportStatus;
  changed: boolean;
};

// Canonicalize the long OUI vendor strings (often legal-entity names like
// "Google, Inc.") down to a short brand we can use to match icons and
// dedupe across product lines.
const VENDOR_CANONICAL_MAP: Array<{ match: RegExp; canonical: string }> = [
  { match: /\bnest labs\b/i, canonical: "Nest" },
  { match: /\bgoogle\b/i, canonical: "Google" },
  { match: /\bapple\b/i, canonical: "Apple" },
  { match: /\bamazon\b/i, canonical: "Amazon" },
  { match: /\bmicrosoft\b/i, canonical: "Microsoft" },
  { match: /\bubiquiti\b/i, canonical: "Ubiquiti" },
  { match: /\bunifi\b/i, canonical: "Ubiquiti" },
  { match: /\bstarlink\b/i, canonical: "Starlink" },
  { match: /\bspacex\b/i, canonical: "Starlink" },
  { match: /\bsamsung\b/i, canonical: "Samsung" },
  { match: /\blg electronics\b/i, canonical: "LG" },
  { match: /\bhp\b/i, canonical: "HP" },
  { match: /\bdell\b/i, canonical: "Dell" },
  { match: /\blenovo\b/i, canonical: "Lenovo" },
  { match: /\bhoneywell\b/i, canonical: "Honeywell" },
  { match: /\becobee\b/i, canonical: "Ecobee" },
  { match: /\bring\b/i, canonical: "Ring" },
  { match: /\barlo\b/i, canonical: "Arlo" },
  { match: /\bphilips\b/i, canonical: "Philips" },
  { match: /\bsonos\b/i, canonical: "Sonos" },
  { match: /\broku\b/i, canonical: "Roku" },
  { match: /\btp[-\s]?link\b/i, canonical: "TP-Link" },
  { match: /\bcisco\b/i, canonical: "Cisco" },
  { match: /\bnetgear\b/i, canonical: "Netgear" },
  { match: /\basus\b/i, canonical: "Asus" },
  { match: /\bintel\b/i, canonical: "Intel" },
  { match: /\bnvidia\b/i, canonical: "Nvidia" },
];

function canonicalizeVendor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  for (const { match, canonical } of VENDOR_CANONICAL_MAP) {
    if (match.test(trimmed)) return canonical;
  }
  // Strip common corporate suffixes when no canonical match — "Foo
  // Technologies Inc." → "Foo". Keeps the brand readable without
  // hand-listing every vendor. The whitespace quantifier is bounded
  // (\s{0,8}) to avoid the polynomial-ReDoS surface CodeQL flags on
  // `\s*` against attacker-controlled long inputs.
  return trimmed
    .replace(/,?\s{0,8}(inc\.?|incorporated|corp\.?|corporation|llc|ltd\.?|limited|gmbh|co\.?|company|technologies?)$/i, "")
    .trim() || trimmed;
}

// Pick the best icon key the UI knows how to render. The set must match
// EstateGlyph's switch — adding a new key here without adding it there
// silently falls through to the generic placeholder.
const SUPPORTED_ICON_KEYS = new Set([
  "gateway",
  "switch",
  "wifi",
  "camera",
  "security",
  "facility",
  "media",
  "host",
  "device",
  "service",
  "package",
  "storage",
  "database",
  "container",
  "application",
  "monitoring",
  "network",
  "ai",
  "thermostat",
  "appliance",
  "phone",
  "speaker",
  "router",
]);

type IconResolutionInput = {
  entityType: string;
  manufacturer: string | null;
  name: string;
  properties: Record<string, unknown>;
};

function resolveIconKey(input: IconResolutionInput): string | null {
  const name = input.name.toLowerCase();
  const manufacturer = (input.manufacturer ?? "").toLowerCase();
  const entityType = input.entityType.toLowerCase();

  // Name-based hints win first — "Nest-Thermostat-3D8D" is unambiguous
  // even when entityType is just "host" / "network_client".
  if (/thermostat/.test(name)) return "thermostat";
  if (/camera|cam[-_]/.test(name) || /\bcam\b/.test(name)) return "camera";
  if (/dryer|washer|laundry|fridge|refriger|microwave|oven|dishwash/.test(name)) return "appliance";
  if (/phone|ipad|iphone|android/.test(name)) return "phone";
  if (/sonos|speaker|alexa|echo|homepod/.test(name)) return "speaker";
  if (/router|gateway/.test(name)) return "router";

  // Manufacturer hints — Nest devices are usually thermostats/cameras;
  // Ubiquiti is networking gear.
  if (manufacturer === "nest" && entityType === "host") return "thermostat";
  if (manufacturer === "ubiquiti") {
    if (/u[67]\b|ap\s|access\s?point|flex/.test(name)) return "wifi";
    if (/switch|usw/.test(name)) return "switch";
    return "network";
  }

  // EntityType fallback — covers the structural cases.
  switch (entityType) {
    case "subnet":
    case "vlan":
      return "network";
    case "gateway":
    case "router":
      return "router";
    case "switch":
      return "switch";
    case "access_point":
      return "wifi";
    case "database":
      return "database";
    case "container":
    case "docker_host":
      return "container";
    case "monitoring_service":
      return "monitoring";
    case "runtime":
    case "service":
      return "service";
    case "application":
      return "application";
    case "network_interface":
    case "network_client":
      return "device";
    case "host":
      return "host";
    default:
      return null;
  }
}

// Parse a Docker image string like "postgres:16-alpine" or
// "ghcr.io/opendigitalproductfactory/dpf-edge-node:latest" into
// manufacturer (image base name) + version (tag).
function parseContainerImage(image: string): { manufacturer: string | null; version: string | null } {
  // Split off the tag.
  const lastColon = image.lastIndexOf(":");
  let tag: string | null = null;
  let repo = image;
  // Treat ":" as a tag separator only when it appears after the last "/"
  // — otherwise it's a port in the registry hostname.
  if (lastColon > image.lastIndexOf("/")) {
    repo = image.slice(0, lastColon);
    tag = image.slice(lastColon + 1) || null;
  }
  // Strip registry + namespace, keep the trailing image name.
  const parts = repo.split("/");
  const name = parts[parts.length - 1] ?? null;
  return {
    manufacturer: name && name.trim() ? name.trim() : null,
    version: tag && tag !== "latest" ? tag : (tag === "latest" ? "latest" : null),
  };
}

function readPropertiesObject(value: Prisma.JsonValue): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Decide whether we have enough identity evidence to flip supportStatus
// from "unknown" → "supported". The bar is intentionally low: if we know
// who made it, we know enough to stop nagging the operator with "1
// unknown support posture" on every device. Genuine support concerns
// (EOL dates, expired warranties) come from lifecycle-evaluation.ts in
// the customer-estate flow; this module just stops the default "unknown"
// from being load-bearing.
function deriveSupportStatus(
  enrichedManufacturer: string | null,
  enrichedVersion: string | null,
  existing: string,
): SupportStatus {
  // Never downgrade a non-unknown status — lifecycle-evaluation may have
  // set "expired"/"approaching_end" with real evidence we shouldn't
  // overwrite.
  if (existing && existing !== "unknown") return existing as SupportStatus;
  if (enrichedManufacturer && (enrichedVersion || enrichedManufacturer !== "Unknown")) {
    return "supported";
  }
  return "unknown";
}

// For database/service/runtime/monitoring entities whose name IS the
// product (e.g. entityType=database, name="postgres"), infer the
// manufacturer from the name. Saves operators from "Unknown vendor" on
// the standalone service rows that have no MAC OUI or container image.
const SERVICE_NAME_MANUFACTURERS: Record<string, string> = {
  postgres: "postgres",
  postgresql: "postgres",
  mysql: "mysql",
  mariadb: "mariadb",
  redis: "redis",
  neo4j: "neo4j",
  qdrant: "qdrant",
  elasticsearch: "elastic",
  prometheus: "prometheus",
  grafana: "grafana",
  inngest: "inngest",
  nginx: "nginx",
  envoy: "envoy",
  haproxy: "haproxy",
  rabbitmq: "rabbitmq",
  kafka: "apache-kafka",
  mongodb: "mongodb",
  cadvisor: "google-cadvisor",
};

function inferManufacturerFromServiceName(entityType: string, name: string): string | null {
  if (!["database", "service", "runtime", "monitoring_service", "application"].includes(entityType.toLowerCase())) {
    return null;
  }
  const key = name.trim().toLowerCase();
  return SERVICE_NAME_MANUFACTURERS[key] ?? null;
}

export function deriveInventoryEnrichment(entity: EnrichableEntity): EnrichmentResult {
  const properties = readPropertiesObject(entity.properties);

  // Manufacturer — prefer the unifi-normalized short form, then full OUI
  // vendor, then container image base name.
  let manufacturer = entity.manufacturer;
  if (!manufacturer) {
    manufacturer =
      canonicalizeVendor(asString(properties.vendorShort))
      ?? canonicalizeVendor(asString(properties.vendor))
      ?? canonicalizeVendor(asString(properties.unifiOui))
      ?? inferManufacturerFromServiceName(entity.entityType, entity.name)
      ?? null;
  }

  // Container image gives us both manufacturer (image base) and version
  // (tag) at once for the 112 container entities.
  let productModel = entity.productModel;
  let observedVersion = entity.observedVersion;
  let normalizedVersion = entity.normalizedVersion;

  const image = asString(properties.image);
  if (image) {
    const parsed = parseContainerImage(image);
    if (!manufacturer && parsed.manufacturer) manufacturer = parsed.manufacturer;
    if (!productModel && parsed.manufacturer) productModel = parsed.manufacturer;
    if (!observedVersion && parsed.version) observedVersion = parsed.version;
    if (!normalizedVersion && parsed.version && parsed.version !== "latest") {
      normalizedVersion = parsed.version;
    }
  }

  // Other version sources occasionally seen in properties.
  if (!observedVersion) {
    observedVersion =
      asString(properties.osVersion)
      ?? asString(properties.firmwareVersion)
      ?? asString(properties.version)
      ?? null;
  }

  const iconKey =
    entity.iconKey
    ?? resolveIconKey({
      entityType: entity.entityType,
      manufacturer,
      name: entity.name,
      properties,
    });

  const supportStatus = deriveSupportStatus(manufacturer, observedVersion, entity.supportStatus);

  const changed =
    manufacturer !== entity.manufacturer
    || productModel !== entity.productModel
    || observedVersion !== entity.observedVersion
    || normalizedVersion !== entity.normalizedVersion
    || iconKey !== entity.iconKey
    || supportStatus !== entity.supportStatus;

  return {
    manufacturer,
    productModel,
    observedVersion,
    normalizedVersion,
    iconKey,
    supportStatus,
    changed,
  };
}

// Build a Prisma update payload that only sets fields whose enrichment
// produced a non-null value AND whose existing column is empty. This is
// the idempotency contract: rerunning enrichment on an already-enriched
// row is a no-op.
export function buildEnrichmentUpdate(
  entity: EnrichableEntity,
  result: EnrichmentResult,
): Prisma.InventoryEntityUpdateInput | null {
  const update: Prisma.InventoryEntityUpdateInput = {};
  let touched = false;

  if (!entity.manufacturer && result.manufacturer) {
    update.manufacturer = result.manufacturer;
    touched = true;
  }
  if (!entity.productModel && result.productModel) {
    update.productModel = result.productModel;
    touched = true;
  }
  if (!entity.observedVersion && result.observedVersion) {
    update.observedVersion = result.observedVersion;
    touched = true;
  }
  if (!entity.normalizedVersion && result.normalizedVersion) {
    update.normalizedVersion = result.normalizedVersion;
    touched = true;
  }
  if (!entity.iconKey && result.iconKey) {
    update.iconKey = result.iconKey;
    touched = true;
  }
  if (entity.supportStatus === "unknown" && result.supportStatus !== "unknown") {
    update.supportStatus = result.supportStatus;
    touched = true;
  }

  return touched ? update : null;
}

export { SUPPORTED_ICON_KEYS, canonicalizeVendor, parseContainerImage, resolveIconKey };
