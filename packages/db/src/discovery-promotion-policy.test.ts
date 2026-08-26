import { describe, expect, it } from "vitest";
import {
  LEGACY_PROMOTABLE_TYPES,
  looksLikeRuntimeArtifact,
  isNonProductEntityType,
  classifyEstateProvenance,
  hasObservationEvidence,
  resolvePromotionDecision,
  isTerminalStructuralSkip,
  TERMINAL_STRUCTURAL_SKIP_SOURCES,
} from "./discovery-promotion-policy";

describe("hasObservationEvidence (BI-B19C41B8)", () => {
  it("is true for a host that answered ARP (has a MAC)", () => {
    expect(hasObservationEvidence({ properties: { mac: "88:e7:12:00:00:91", address: "192.168.0.91" } })).toBe(true);
  });
  it("is true for a UniFi-listed client even without a per-row MAC", () => {
    expect(hasObservationEvidence({ properties: { discoveredVia: "unifi_clients_api", address: "192.168.0.42" } })).toBe(true);
  });
  it("is FALSE for a bare enumerated IP that never answered (no MAC, arp sweep)", () => {
    expect(hasObservationEvidence({ properties: { discoveredVia: "arp_table", address: "192.168.0.0" } })).toBe(false);
    expect(hasObservationEvidence({ properties: {} })).toBe(false);
  });
});

describe("resolvePromotionDecision — evidence gate (BI-B19C41B8)", () => {
  const node = { id: "tn_1", nodeId: "foundational/compute/servers", governance: null };
  const portfolio = { id: "p_1", slug: "foundational" };
  const host = {
    entityType: "host",
    attributionStatus: "attributed" as const,
    attributionConfidence: 0.95,
    digitalProductId: null,
    taxonomyNodeId: "tn_1",
    provenance: "real_estate" as const,
  };

  it("skips a real-estate host with NO observation evidence (subnet phantom)", () => {
    const d = resolvePromotionDecision(
      { ...host, name: "LAN Host 192.168.0.0", hasObservationEvidence: false },
      node,
      portfolio,
    );
    expect(d.decision).toBe("skip");
    expect(d.reason).toBe("no_observation_evidence");
    expect(isTerminalStructuralSkip(d)).toBe(true);
  });

  it("promotes an evidenced real-estate device", () => {
    const d = resolvePromotionDecision(
      { ...host, name: "Reolink NVR", hasObservationEvidence: true },
      node,
      portfolio,
    );
    expect(d.decision).toBe("promote");
  });
});

describe("resolvePromotionDecision", () => {
  const baseEntity = {
    // Switched from "host" to "application" after BI-79307D22 — `host`
    // is no longer on the legacy promotable list (it's runtime/infra,
    // attributed to a product rather than promoted into one).
    entityType: "application",
    name: "Real Product",
    attributionStatus: "attributed" as const,
    attributionConfidence: 0.95,
    digitalProductId: null,
    taxonomyNodeId: "tn_1",
  };
  const taxonomyNode = { id: "tn_1", nodeId: "foundational/compute/servers", governance: null };
  const portfolio = { id: "p_1", slug: "foundational" };

  it("approves when policy is auto and all gates pass", () => {
    const node = { ...taxonomyNode, governance: { promotion: { mode: "auto" } } };
    expect(resolvePromotionDecision(baseEntity, node, portfolio)).toEqual({
      decision: "promote",
      classifyAs: undefined,
      evidence: { source: "node-policy" },
    });
  });

  it("falls back to legacy PROMOTABLE_TYPES when governance.promotion is missing", () => {
    expect(resolvePromotionDecision(baseEntity, taxonomyNode, portfolio).decision).toBe("promote");
    const ne = { ...baseEntity, entityType: "network_client" };
    const skip = resolvePromotionDecision(ne, taxonomyNode, portfolio);
    expect(skip.decision).toBe("skip");
    expect(skip.reason).toBe("type_not_promotable");
  });

  it("skips with reason 'low_confidence_promotion' below threshold", () => {
    const e = { ...baseEntity, attributionConfidence: 0.5 };
    expect(resolvePromotionDecision(e, taxonomyNode, portfolio).reason).toBe("low_confidence_promotion");
  });

  it("skips with reason 'no_taxonomy' when taxonomyNode is null", () => {
    const e = { ...baseEntity, taxonomyNodeId: null };
    expect(resolvePromotionDecision(e, null, portfolio).reason).toBe("no_taxonomy");
  });

  it("skips with reason 'no_portfolio_root' when portfolio not found", () => {
    expect(resolvePromotionDecision(baseEntity, taxonomyNode, null).reason).toBe("no_portfolio_root");
  });

  it("emits classifyAs from policy when provided (on a product-shaped entity)", () => {
    const node = { ...taxonomyNode, governance: { promotion: { mode: "auto", classifyAs: "managed_service" } } };
    // A product-shaped type with a non-runtime name promotes, and classifyAs
    // flows through. (Infra types are blocked by the structural gate even with
    // an auto policy — see the structural-type-gate describe block below.)
    const e = { ...baseEntity, entityType: "service", name: "Custom Managed Service" };
    expect(resolvePromotionDecision(e, node, portfolio).classifyAs).toBe("managed_service");
  });

  describe("name-shape gate (BI-79307D22)", () => {
    it("rejects 'dpf-postgres-1' even when the entityType + taxonomy policy approve", () => {
      const node = { ...taxonomyNode, governance: { promotion: { mode: "auto" } } };
      const decision = resolvePromotionDecision(
        { ...baseEntity, name: "dpf-postgres-1" },
        node,
        portfolio,
      );
      expect(decision.decision).toBe("skip");
      expect(decision.reason).toBe("name_not_promotable");
    });

    it("rejects 'Docker GW dpf_default (172.18.0.1)'", () => {
      const decision = resolvePromotionDecision(
        { ...baseEntity, name: "Docker GW dpf_default (172.18.0.1)" },
        taxonomyNode,
        portfolio,
      );
      expect(decision.reason).toBe("name_not_promotable");
    });

    it("rejects bare IPv4 addresses", () => {
      const decision = resolvePromotionDecision(
        { ...baseEntity, name: "192.168.0.109" },
        taxonomyNode,
        portfolio,
      );
      expect(decision.reason).toBe("name_not_promotable");
    });

    it("accepts canonical product names like 'postgres'", () => {
      const decision = resolvePromotionDecision(
        { ...baseEntity, name: "postgres", entityType: "database" },
        taxonomyNode,
        portfolio,
      );
      expect(decision.decision).toBe("promote");
    });
  });

  describe("structural entityType gate (estate-accuracy)", () => {
    const autoNode = { ...taxonomyNode, governance: { promotion: { mode: "auto" } } };

    it("rejects a 'host' even when its taxonomy node auto-promotes", () => {
      // The exact live leak: "foundational/compute/servers" is mode:auto and a
      // host name like "LAN Host 172.18.0.1" slips past the name-gate.
      const decision = resolvePromotionDecision(
        { ...baseEntity, entityType: "host", name: "LAN Host 172.18.0.1" },
        autoNode,
        portfolio,
      );
      expect(decision.decision).toBe("skip");
      expect(decision.reason).toBe("type_not_promotable");
      expect(decision.evidence.source).toBe("structural-type-gate");
    });

    it("rejects a 'network_interface' even with classifyAs:infrastructure_endpoint", () => {
      const node = {
        ...taxonomyNode,
        governance: { promotion: { mode: "auto", classifyAs: "infrastructure_endpoint" } },
      };
      const decision = resolvePromotionDecision(
        { ...baseEntity, entityType: "network_interface", name: "eth0 (172.18.0.11)" },
        node,
        portfolio,
      );
      expect(decision.decision).toBe("skip");
      expect(decision.reason).toBe("type_not_promotable");
    });

    it.each(["host", "docker_host", "container", "network_interface", "subnet", "gateway", "switch", "access_point", "router", "network_client"])(
      "hard-blocks infra type %s regardless of auto policy",
      (entityType) => {
        const decision = resolvePromotionDecision(
          { ...baseEntity, entityType, name: "Some Infra Thing" },
          autoNode,
          portfolio,
        );
        expect(decision.decision).toBe("skip");
        expect(decision.evidence.source).toBe("structural-type-gate");
      },
    );

    it("still promotes product-shaped types (database, service, application) under auto policy", () => {
      for (const entityType of ["database", "service", "application", "monitoring_service"]) {
        const decision = resolvePromotionDecision(
          { ...baseEntity, entityType, name: "Real Product" },
          autoNode,
          portfolio,
        );
        expect(decision.decision).toBe("promote");
      }
    });
  });
});

describe("looksLikeRuntimeArtifact", () => {
  it.each([
    ["dpf-redis-1", true],
    ["dpf-postgres-1", true],
    ["Docker GW dpf_default (172.18.0.1)", true],
    ["192.168.0.109", true],
    ["abc123def456", true],
    // The WAN uplink is the estate's most critical dependency, NOT a runtime
    // artifact. The `(WAN\d*)` pattern used to reject these, keeping the
    // internet connection out of the portfolio while Docker rows sailed through.
    ["Primary Starlink (WAN1)", false],
    ["Starlink (WAN)", false],
    ["Digital Product Factory Portal", false],
    ["postgres", false],
    ["qdrant", false],
    ["Real Product Name", false],
  ])("classifies %s as runtime=%s", (name, expected) => {
    expect(looksLikeRuntimeArtifact(name)).toBe(expected);
  });
});

describe("classifyEstateProvenance", () => {
  it("classifies UniFi-discovered devices as real_estate", () => {
    expect(classifyEstateProvenance({ discoveredVia: "unifi_clients_api", addressHint: "192.168.0.42" })).toBe("real_estate");
    expect(classifyEstateProvenance({ discoveredVia: "unifi_api" })).toBe("real_estate");
  });
  it("classifies real-LAN IPs as real_estate", () => {
    expect(classifyEstateProvenance({ addressHint: "192.168.0.59" })).toBe("real_estate");
    expect(classifyEstateProvenance({ addressHint: "Doorbell Camera 192.168.0.7" })).toBe("real_estate");
  });
  it("classifies Docker-bridge IPs and platform sources as platform_internal", () => {
    expect(classifyEstateProvenance({ discoveredVia: "arp_table", addressHint: "172.18.0.5" })).toBe("platform_internal");
    expect(classifyEstateProvenance({ discoveredVia: "local_os" })).toBe("platform_internal");
    expect(classifyEstateProvenance({ discoveredVia: "windows_exporter", addressHint: "172.20.0.1" })).toBe("platform_internal");
  });
  it("defaults unknown provenance to platform_internal (conservative)", () => {
    expect(classifyEstateProvenance({})).toBe("platform_internal");
    expect(classifyEstateProvenance({ discoveredVia: "mystery", addressHint: "8.8.8.8" })).toBe("platform_internal");
  });
  it("platform source wins over a real-LAN IP", () => {
    expect(classifyEstateProvenance({ discoveredVia: "docker", addressHint: "192.168.0.1" })).toBe("platform_internal");
  });
});

describe("resolvePromotionDecision — estate provenance", () => {
  const node = { id: "tn_1", nodeId: "foundational/building_management/security_and_surveillance", governance: null };
  const portfolio = { id: "p_1", slug: "foundational" };
  const realDevice = {
    entityType: "host", // would normally be blocked by the structural gate
    name: "Reolink NVR",
    attributionStatus: "attributed" as const,
    attributionConfidence: 0.95,
    digitalProductId: null,
    taxonomyNodeId: "tn_1",
  };

  it("PROMOTES a real-estate host device (camera/NVR) despite host entityType", () => {
    const d = resolvePromotionDecision({ ...realDevice, provenance: "real_estate" }, node, portfolio);
    expect(d.decision).toBe("promote");
    expect(d.evidence.source).toBe("real-estate-provenance");
  });

  it("still SKIPS a platform-internal host (Docker) via the structural gate", () => {
    const d = resolvePromotionDecision({ ...realDevice, name: "LAN Host 172.18.0.5", provenance: "platform_internal" }, node, portfolio);
    expect(d.decision).toBe("skip");
    expect(d.reason).toBe("type_not_promotable");
  });

  it("treats omitted provenance as platform_internal (back-compat: host still skips)", () => {
    const d = resolvePromotionDecision(realDevice, node, portfolio);
    expect(d.decision).toBe("skip");
    expect(d.reason).toBe("type_not_promotable");
  });

  it("real-estate provenance does not override the runtime-name gate", () => {
    const d = resolvePromotionDecision({ ...realDevice, name: "dpf-redis-1", provenance: "real_estate" }, node, portfolio);
    expect(d.decision).toBe("skip");
    expect(d.reason).toBe("name_not_promotable");
  });
});

describe("isTerminalStructuralSkip (BI-62846516)", () => {
  const node = { id: "tn_1", nodeId: "foundational/compute/servers", governance: null };
  const portfolio = { id: "p_1", slug: "foundational" };
  const base = {
    entityType: "application",
    name: "Real Product",
    attributionStatus: "attributed" as const,
    attributionConfidence: 0.95,
    digitalProductId: null,
    taxonomyNodeId: "tn_1",
  };

  it("TERMINAL_STRUCTURAL_SKIP_SOURCES is exactly the structural gates", () => {
    expect([...TERMINAL_STRUCTURAL_SKIP_SOURCES].sort()).toEqual([
      "evidence-gate",
      "name-gate",
      "structural-type-gate",
    ]);
  });

  it("classifies a name-gate skip (dpf-redis-1) as terminal", () => {
    const d = resolvePromotionDecision({ ...base, name: "dpf-redis-1" }, node, portfolio);
    expect(d.reason).toBe("name_not_promotable");
    expect(isTerminalStructuralSkip(d)).toBe(true);
  });

  it("classifies a structural-type-gate skip (host) as terminal", () => {
    const d = resolvePromotionDecision(
      { ...base, entityType: "host", name: "LAN Host 172.18.0.5" },
      node,
      portfolio,
    );
    expect(d.reason).toBe("type_not_promotable");
    expect(d.evidence.source).toBe("structural-type-gate");
    expect(isTerminalStructuralSkip(d)).toBe(true);
  });

  it("does NOT classify actionable gaps (no_taxonomy / low_confidence / no_portfolio_root) as terminal", () => {
    expect(isTerminalStructuralSkip(resolvePromotionDecision({ ...base, taxonomyNodeId: null }, null, portfolio))).toBe(false);
    expect(isTerminalStructuralSkip(resolvePromotionDecision({ ...base, attributionConfidence: 0.5 }, node, portfolio))).toBe(false);
    expect(isTerminalStructuralSkip(resolvePromotionDecision(base, node, null))).toBe(false);
  });

  it("does NOT classify an actionable legacy-list type_not_promotable as terminal", () => {
    // A non-infra type with no governance policy is an actionable gap (add a
    // promotion policy), not a terminal structural rejection — its source is
    // "legacy-list", not "structural-type-gate".
    const d = resolvePromotionDecision({ ...base, entityType: "custom_widget" }, node, portfolio);
    expect(d.reason).toBe("type_not_promotable");
    expect(d.evidence.source).toBe("legacy-list");
    expect(isTerminalStructuralSkip(d)).toBe(false);
  });

  it("does NOT classify a promote decision as terminal", () => {
    const autoNode = { ...node, governance: { promotion: { mode: "auto" } } };
    const d = resolvePromotionDecision(base, autoNode, portfolio);
    expect(d.decision).toBe("promote");
    expect(isTerminalStructuralSkip(d)).toBe(false);
  });
});

describe("isNonProductEntityType", () => {
  it.each([
    ["host", true],
    ["docker_host", true],
    ["container", true],
    ["network_interface", true],
    ["subnet", true],
    ["gateway", true],
    ["switch", true],
    ["access_point", true],
    ["router", true],
    ["network_client", true],
    ["HOST", true], // case-insensitive
    [" host ", true], // trims
    ["database", false],
    ["service", false],
    ["application", false],
    ["monitoring_service", false],
    ["runtime", false],
    ["ai_service", false],
  ])("classifies %s as non-product=%s", (entityType, expected) => {
    expect(isNonProductEntityType(entityType)).toBe(expected);
  });
});

describe("LEGACY_PROMOTABLE_TYPES", () => {
  it("contains product-shaped types only (no host/container/network)", () => {
    expect(LEGACY_PROMOTABLE_TYPES).toEqual([
      "runtime",
      "database",
      "monitoring_service",
      "ai_service",
      "application",
      "service",
      // The internet uplink is a managed dependency with a vendor (the ISP), a
      // service level, and an outage blast radius of "everything" — product-
      // shaped, not a runtime instance.
      "wan_uplink",
    ]);
  });

  it("does not include runtime instance / device / network artifact types", () => {
    for (const removed of ["host", "container", "subnet", "gateway", "network_interface", "docker_host", "router"]) {
      expect(LEGACY_PROMOTABLE_TYPES).not.toContain(removed);
    }
  });
});
