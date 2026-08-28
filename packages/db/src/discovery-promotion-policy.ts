/**
 * Pure promotion policy resolver for the Discovery -> Portfolio handoff.
 *
 * Given a discovered entity, its taxonomy node (if any), and the portfolio
 * root we plan to attach under, decide whether to promote into the digital
 * product portfolio or skip with a structured reason.
 *
 * No DB calls, no I/O — callers fetch the inputs and persist the outcome.
 */

// Product-shaped entity types — things that represent software products in
// their own right, not the infrastructure they run on. Hosts, containers,
// subnets, gateways, switches, etc. are runtime instances/transports, not
// products; they belong as InventoryEntity rows attributed to a product
// (e.g. "dpf-postgres-1 container" attributed to the "postgres" product),
// not as standalone DigitalProduct rows that bloat the portfolio.
//
// Before BI-79307D22 (2026-05-22), this list included the runtime/infra
// types and the dev install ended up with 209 DigitalProducts — 95% of
// them auto-promoted Docker containers like "dpf-redis-1" and gateway IP
// rows like "Docker GW dpf_default (172.18.0.1)". Operators couldn't find
// their real products. The list is now product-shaped types only.
export const LEGACY_PROMOTABLE_TYPES: readonly string[] = [
  "runtime",
  "database",
  "monitoring_service",
  "ai_service",
  "application",
  "service",
  // The internet uplink is a first-class managed dependency, not a runtime
  // instance: it is the single hop the entire estate rides on, it has a vendor
  // (the ISP), a service level, and an outage blast radius of "everything".
  "wan_uplink",
];

// Name patterns that indicate "this is a runtime instance / device / host
// / network artifact, not a product." These reject even if the entity has
// an explicit taxonomy `governance.promotion.mode = "auto"` policy —
// structural shape wins over taxonomy placement here, because the
// alternative is letting bad taxonomy data write bad product rows.
const NON_PRODUCT_NAME_PATTERNS: readonly RegExp[] = [
  /^dpf-/i,                              // dpf-redis-1, dpf-postgres-1, dpf-grafana-1
  /-\d+$/,                               // anything-1, foo-bar-2
  /Docker GW /,                          // Docker GW dpf_default (172.18.0.1)
  /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/,     // raw IPv4 addresses
  /^[a-f0-9]{12}$/i,                     // bare Docker container IDs (short SHA)
  /^arp:/,                               // arp-discovered host placeholders
  // NOTE: `(WAN\d*)` was here, rejecting names like "Primary Starlink (WAN1)" as
  // "VLAN-shape names from unifi". That was backwards: the WAN uplink is the
  // single most critical dependency in the estate — the hop the whole business
  // rides on — and this pattern kept it out of the portfolio entirely while
  // Docker bridge rows sailed through. WAN uplinks are now first-class managed
  // infrastructure (see discovery-collectors/unifi.ts `wan_uplink`), so the
  // pattern is deliberately gone rather than narrowed.
  /^subnet:/,                            // bootstrap subnet placeholders
];

export function looksLikeRuntimeArtifact(name: string): boolean {
  return NON_PRODUCT_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

// Property keys that constitute OBSERVATION EVIDENCE — proof a real device was
// actually seen, not merely an enumerated address. A device that answered ARP
// carries a MAC; a resolved vendor, a real hostname, or observed ports/services
// are equally decisive. A bare enumerated IP with none of these (e.g. the
// network address "192.168.0.0", or a /24 sweep row that never replied) is a
// phantom, not a device.
const OBSERVATION_EVIDENCE_KEYS = ["mac", "macaddress", "mac_address", "vendor", "oui_vendor", "hostname"];

// Discovery sources that only ever report REAL, present devices — a UniFi
// controller's client list, mDNS/SNMP/LLDP/DHCP responders. Being seen through
// one of these is observation evidence in itself, even without a per-row MAC. A
// bare ARP *sweep* is deliberately NOT here: it enumerates every address, so an
// ARP row is only evidence when it actually resolved a MAC (checked above).
const OBSERVED_SOURCE_RE = /unifi|mdns|snmp|lldp|dhcp/i;

/**
 * True when a discovered host/network entity carries evidence it was actually
 * OBSERVED (answered / resolved), not just enumerated. Discovery is
 * evidence-based: an address with no corroborating signal is not a device and
 * must not become inventory or a product. (BI-B19C41B8.)
 */
export function hasObservationEvidence(input: { properties?: unknown }): boolean {
  const props = input.properties;
  if (!props || typeof props !== "object") return false;
  const bag = props as Record<string, unknown>;
  const present = (key: string): boolean => {
    const v = bag[key];
    return v !== null && v !== undefined && v !== "";
  };
  if (Object.keys(bag).some((k) => OBSERVATION_EVIDENCE_KEYS.includes(k.toLowerCase()) && present(k))) {
    return true;
  }
  // Observed ports/services also prove the host is real.
  for (const k of ["ports", "openPorts", "services"]) {
    const v = bag[k];
    if (Array.isArray(v) && v.length > 0) return true;
  }
  // Seen through a controller/protocol that only reports real devices.
  const via = bag.discoveredVia;
  if (typeof via === "string" && OBSERVED_SOURCE_RE.test(via)) return true;
  return false;
}

// Entity types that are infrastructure / transport / runtime instances —
// never products in their own right, regardless of taxonomy promotion policy.
// A host or network interface is something products RUN ON, not a product;
// it belongs as an InventoryEntity attributed to a product (e.g. the
// "dpf-postgres-1 container" inventory row attributed to the "postgres"
// product), not as a standalone DigitalProduct.
//
// This is a STRUCTURAL gate, like the name-gate: it wins over a taxonomy
// node's governance.promotion.mode = "auto". Without it, an auto-promotion
// policy on a node such as "foundational/compute/servers" or
// "foundational/network_management/network_connectivity" promotes every
// discovered container IP / NIC / subnet into the product portfolio.
// (Observed live: 38 host/network_interface/subnet/gateway rows bypassed the
// name-gate — names like "LAN Host 172.18.0.1" / "eth0 (172.18.0.11)" don't
// match the runtime-artifact patterns — and were auto-promoted, burying the
// 3 real products. classifyAs:"infrastructure_endpoint" did NOT save them
// from polluting the portfolio.)
export const NON_PRODUCT_ENTITY_TYPES: ReadonlySet<string> = new Set([
  "host",
  "docker_host",
  "container",
  "network_interface",
  "subnet",
  "gateway",
  "switch",
  "access_point",
  "router",
  "vlan",
  "wlan",
  "network_client",
]);

export function isNonProductEntityType(entityType: string): boolean {
  return NON_PRODUCT_ENTITY_TYPES.has(entityType.trim().toLowerCase());
}

// ── Estate provenance ───────────────────────────────────────────────────────
//
// Distinguish the operator's REAL digital-product estate from the platform's
// own black-box runtime. The reference standards (The Open Group, "The Shift
// to Digital Product") classify IoT doorbells, cameras, smart appliances, and
// connected devices as Digital Products in their own right — so a real-estate
// `host`/`network_interface` (a Reolink NVR, a UniFi gateway) SHOULD become a
// Foundational Digital Product, while the platform's own Docker containers /
// local host (the bootstrap self-scan) are infrastructure plumbing the operator
// treats as a black box. Operator direction: "the 192.168 range is the real
// estate; the 172.18 Docker network is the platform black box."
//
// This provenance signal is what lets the structural entityType gate stay
// correct for platform-internal infra (the 38 Docker rows it removed) WITHOUT
// also blocking the operator's real connected devices.
export type EstateProvenance = "real_estate" | "platform_internal";

// Docker default bridge range (RFC1918 172.16/12) and the platform's own
// self-scan collector sources.
const DOCKER_BRIDGE_IP_RE = /(?:^|[^0-9])172\.(?:1[6-9]|2[0-9]|3[01])\./;
const PLATFORM_SOURCE_RE = /docker|local_os|windows_exporter|node_exporter|prometheus|kubernetes|bootstrap|cadvisor/i;
// Operator's real LAN (UniFi-discovered, or RFC1918 ranges that aren't the
// Docker bridge).
const REAL_ESTATE_SOURCE_RE = /unifi/i;
const REAL_LAN_IP_RE = /(?:^|[^0-9])(?:192\.168|10)\./;

export function classifyEstateProvenance(input: {
  discoveredVia?: string | null;
  /** An IP-bearing string for the entity (its address, or its name). */
  addressHint?: string | null;
}): EstateProvenance {
  const via = input.discoveredVia ?? "";
  const addr = input.addressHint ?? "";
  // Platform signals win first: the platform's own containers/host can appear on
  // odd ranges, so an explicit platform source or a Docker-bridge IP is decisive.
  if (PLATFORM_SOURCE_RE.test(via)) return "platform_internal";
  if (DOCKER_BRIDGE_IP_RE.test(addr)) return "platform_internal";
  // Real-estate signals: discovered through the operator's network controller,
  // or living on the operator's real LAN.
  if (REAL_ESTATE_SOURCE_RE.test(via)) return "real_estate";
  if (REAL_LAN_IP_RE.test(addr)) return "real_estate";
  // Conservative default: treat unknown provenance as platform-internal so we
  // never promote an unidentified infra row into the product portfolio.
  return "platform_internal";
}

export const AUTO_PROMOTE_THRESHOLD = 0.9;

export type PromotionSkipReason =
  | "no_taxonomy"
  | "low_confidence_promotion"
  | "no_portfolio_root"
  | "type_not_promotable"
  | "name_not_promotable"
  | "no_observation_evidence";

/**
 * Evidence is a small, JSON-serializable bag of decision context. The set
 * of keys varies by `source`; downstream consumers (e.g. Task 1.2's quality
 * issue writer, Task 2.1's promotion runner) read `source` first, then the
 * source-specific fields. Values are restricted to JSON primitives so the
 * envelope can be stored directly in `PortfolioQualityIssue.details`.
 */
export type PromotionEvidence = Record<string, string | number | null>;

export type PromotionDecision =
  | { decision: "promote"; classifyAs?: string; reason?: undefined; evidence: PromotionEvidence }
  | { decision: "skip"; classifyAs?: undefined; reason: PromotionSkipReason; evidence: PromotionEvidence };

// ── Terminal structural skips vs. actionable gaps ────────────────────────────
//
// A skip decision can mean one of two very different things:
//
//   1. A TERMINAL STRUCTURAL classification — "this entity is infrastructure /
//      a runtime instance, and is CORRECTLY not a digital product." The name-gate
//      ("dpf-redis-1", raw IPs) and the structural-type-gate (host/container/
//      subnet/NIC/gateway) produce these. Nothing an operator does will ever make
//      a Docker container a product; the decision is final and correct.
//
//   2. An ACTIONABLE GAP — "this entity could be promoted, but something is
//      missing/wrong": no_taxonomy (attribute it), low_confidence_promotion
//      (re-run attribution), no_portfolio_root (seed the portfolio), or a
//      type_not_promotable from the legacy-list / non-auto node policy (add a
//      governance.promotion policy).
//
// Only class (2) belongs in the operator-facing PortfolioQualityIssue queue.
// Recording class (1) there was the original design mistake (BI-62846516): the
// dev install accumulated 378 permanent-open name/type_not_promotable rows for
// its own Docker self-scan, drowning the handful of real, fixable issues. These
// are keyed by the decision's `evidence.source`, which is the precise
// discriminator — `type_not_promotable` alone is ambiguous (it also covers the
// actionable legacy-list / node-policy cases), but its SOURCE is not.
export const TERMINAL_STRUCTURAL_SKIP_SOURCES: ReadonlySet<string> = new Set([
  "name-gate",
  "structural-type-gate",
  // A phantom (unevidenced) address is a terminal structural classification —
  // there is nothing an operator can "fix"; it simply isn't a device.
  "evidence-gate",
]);

/**
 * True when a decision is a TERMINAL STRUCTURAL skip — a correct "this is
 * infrastructure, not a product" classification that must NOT be surfaced as an
 * open portfolio quality issue (it can never be resolved). Distinguished from
 * actionable gaps by `evidence.source`, not by the skip `reason` (which is
 * ambiguous for `type_not_promotable`). Returns false for promote decisions.
 */
export function isTerminalStructuralSkip(decision: PromotionDecision): boolean {
  if (decision.decision !== "skip") return false;
  const source = decision.evidence.source;
  return typeof source === "string" && TERMINAL_STRUCTURAL_SKIP_SOURCES.has(source);
}

/**
 * Loose input shapes — callers may pass richer Prisma rows; only these
 * fields are read.
 */
export interface PromotionEntityInput {
  entityType: string;
  // Required for the structural name-shape gate (BI-79307D22). Older
  // callers that omit this get the same behaviour they had pre-fix —
  // the name gate just doesn't fire.
  name?: string;
  attributionStatus?: string;
  attributionConfidence: number;
  digitalProductId: string | null;
  taxonomyNodeId: string | null;
  // Estate provenance. When "real_estate", the structural entityType gate does
  // NOT apply — a real connected device (camera, NVR, gateway) IS a Digital
  // Product even though its entityType is host/network. Omitted/undefined keeps
  // the prior conservative behaviour (treated as platform_internal).
  provenance?: EstateProvenance;
  // Whether the entity carries observation evidence (answered / resolved). A
  // real-estate host with `false` is a whole-subnet-scan phantom, not a device,
  // and is not promoted. Omitted/undefined keeps prior behaviour (not gated), so
  // older callers that don't compute evidence are unaffected. (BI-B19C41B8.)
  hasObservationEvidence?: boolean;
}

export interface PromotionTaxonomyNodeInput {
  id: string;
  nodeId: string;
  governance:
    | {
        promotion?: {
          // "auto" is the only mode the resolver acts on today; other values
          // (e.g. a future "manual") fall through to the type_not_promotable
          // skip path. Open to extension via the (string & {}) escape hatch.
          mode?: "auto" | (string & {});
          classifyAs?: string;
        } | null;
      }
    | null;
}

export interface PromotionPortfolioInput {
  id: string;
  slug: string;
}

export function resolvePromotionDecision(
  entity: PromotionEntityInput,
  taxonomyNode: PromotionTaxonomyNodeInput | null,
  portfolio: PromotionPortfolioInput | null,
): PromotionDecision {
  // Gate 1: must have a taxonomy node to attach against.
  if (taxonomyNode === null) {
    return {
      decision: "skip",
      reason: "no_taxonomy",
      evidence: { source: "gate", gate: "no_taxonomy" },
    };
  }

  // Gate 2: confidence must clear the auto-promote bar.
  if (entity.attributionConfidence < AUTO_PROMOTE_THRESHOLD) {
    return {
      decision: "skip",
      reason: "low_confidence_promotion",
      evidence: {
        source: "gate",
        gate: "low_confidence_promotion",
        threshold: AUTO_PROMOTE_THRESHOLD,
        observed: entity.attributionConfidence,
      },
    };
  }

  // Gate 3: portfolio root must exist.
  if (portfolio === null) {
    return {
      decision: "skip",
      reason: "no_portfolio_root",
      evidence: { source: "gate", gate: "no_portfolio_root" },
    };
  }

  // Note: the caller is responsible for filtering out entities that already
  // point at a digital product (Task 2.1's promoteInventoryEntities filters
  // digitalProductId: null at the Prisma query level). The resolver does not
  // gate on digitalProductId — keeping it pure over (entity, node, portfolio).

  // Gate 4 (structural, BI-79307D22): reject runtime instances / devices
  // / network artifacts by name shape, regardless of taxonomy policy.
  // "dpf-postgres-1" is structurally a container — even if a taxonomy
  // node says auto-promote, the right model is to keep it as an
  // InventoryEntity attributed to the canonical "postgres" product.
  if (entity.name && looksLikeRuntimeArtifact(entity.name)) {
    return {
      decision: "skip",
      reason: "name_not_promotable",
      evidence: {
        source: "name-gate",
        name: entity.name,
      },
    };
  }

  // Gate 5 (structural, estate-accuracy): infrastructure / transport /
  // runtime-instance entity types are never products, regardless of taxonomy
  // governance.promotion. Runs BEFORE the auto-policy lookup so an "auto" node
  // (e.g. foundational/compute/servers) cannot promote a host / NIC / subnet
  // into the portfolio. Same precedence rationale as the name-gate: structural
  // shape wins over taxonomy placement, because the alternative is letting an
  // over-broad taxonomy policy write bad product rows.
  // ...EXCEPT for real-estate digital products. A camera / NVR / smart plug /
  // gateway discovered on the operator's LAN (UniFi/arp) is a Digital Product
  // in its own right (The Open Group, "The Shift to Digital Product") even
  // though its entityType is host/network. The structural gate only suppresses
  // the platform's own black-box runtime (its Docker containers / local host).
  if (isNonProductEntityType(entity.entityType) && entity.provenance !== "real_estate") {
    return {
      decision: "skip",
      reason: "type_not_promotable",
      evidence: {
        source: "structural-type-gate",
        entityType: entity.entityType,
        provenance: entity.provenance ?? "platform_internal",
      },
    };
  }

  // Gate 5.5 (evidence, BI-B19C41B8): a real-estate host/network entity becomes
  // a Digital Product only if it was actually OBSERVED. A /24 sweep enumerates
  // every address and promotes a "LAN Host 192.168.0.N" per IP — including the
  // network address .0 that can never answer — burying real devices under
  // hundreds of phantoms. An address with no MAC/vendor/hostname/ports never
  // proved it is a device, so it is not promoted. `undefined` (older callers
  // that don't compute evidence) is NOT gated — only an explicit `false`.
  if (
    isNonProductEntityType(entity.entityType) &&
    entity.provenance === "real_estate" &&
    entity.hasObservationEvidence === false
  ) {
    return {
      decision: "skip",
      reason: "no_observation_evidence",
      evidence: {
        source: "evidence-gate",
        name: entity.name ?? null,
        entityType: entity.entityType,
      },
    };
  }

  // Real-estate provenance: this is the operator's actual connected device, a
  // Digital Product regardless of entityType or the taxonomy node's promotion
  // policy. Gates 1-4 (taxonomy, confidence, portfolio, runtime-name) already
  // passed, so promote it into its Foundational sub-portfolio.
  if (entity.provenance === "real_estate") {
    return {
      decision: "promote",
      ...(taxonomyNode.governance?.promotion?.classifyAs
        ? { classifyAs: taxonomyNode.governance.promotion.classifyAs }
        : {}),
      evidence: { source: "real-estate-provenance" },
    };
  }

  // Policy lookup: governance.promotion on the taxonomy node wins.
  const promotionPolicy = taxonomyNode.governance?.promotion ?? null;

  if (promotionPolicy && promotionPolicy.mode === "auto") {
    return {
      decision: "promote",
      classifyAs: promotionPolicy.classifyAs,
      evidence: { source: "node-policy" },
    };
  }

  // Legacy fallback: type-based allowlist preserves historical behavior.
  if (promotionPolicy === null) {
    if (LEGACY_PROMOTABLE_TYPES.includes(entity.entityType)) {
      return {
        decision: "promote",
        evidence: { source: "legacy-list" },
      };
    }
    return {
      decision: "skip",
      reason: "type_not_promotable",
      evidence: {
        source: "legacy-list",
        entityType: entity.entityType,
      },
    };
  }

  // Policy present but not auto (e.g. "manual"): treat as not promotable.
  return {
    decision: "skip",
    reason: "type_not_promotable",
    evidence: {
      source: "node-policy",
      mode: promotionPolicy.mode ?? null,
    },
  };
}
