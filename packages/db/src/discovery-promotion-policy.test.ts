import { describe, expect, it } from "vitest";
import {
  LEGACY_PROMOTABLE_TYPES,
  looksLikeRuntimeArtifact,
  resolvePromotionDecision,
} from "./discovery-promotion-policy";

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

  it("emits classifyAs from policy when provided", () => {
    const node = { ...taxonomyNode, governance: { promotion: { mode: "auto", classifyAs: "infrastructure_endpoint" } } };
    // Use an entityType the legacy list would reject, then prove the
    // policy override wins. Also pass a non-runtime name so the new
    // name-gate doesn't fire first.
    const e = { ...baseEntity, entityType: "network_client", name: "Custom Service Endpoint" };
    expect(resolvePromotionDecision(e, node, portfolio).classifyAs).toBe("infrastructure_endpoint");
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
});

describe("looksLikeRuntimeArtifact", () => {
  it.each([
    ["dpf-redis-1", true],
    ["dpf-postgres-1", true],
    ["Docker GW dpf_default (172.18.0.1)", true],
    ["192.168.0.109", true],
    ["abc123def456", true],
    ["Primary Starlink (WAN1)", true],
    ["Digital Product Factory Portal", false],
    ["postgres", false],
    ["qdrant", false],
    ["Real Product Name", false],
  ])("classifies %s as runtime=%s", (name, expected) => {
    expect(looksLikeRuntimeArtifact(name)).toBe(expected);
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
    ]);
  });

  it("does not include runtime instance / device / network artifact types", () => {
    for (const removed of ["host", "container", "subnet", "gateway", "network_interface", "docker_host", "router"]) {
      expect(LEGACY_PROMOTABLE_TYPES).not.toContain(removed);
    }
  });
});
