import { describe, expect, it } from "vitest";
import { resolvePromotionDecision, LEGACY_PROMOTABLE_TYPES } from "./discovery-promotion-policy";

describe("resolvePromotionDecision", () => {
  const baseEntity = {
    entityType: "host",
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
    const e = { ...baseEntity, entityType: "network_client" };
    expect(resolvePromotionDecision(e, node, portfolio).classifyAs).toBe("infrastructure_endpoint");
  });
});

describe("LEGACY_PROMOTABLE_TYPES", () => {
  it("matches the historical list exactly", () => {
    expect(LEGACY_PROMOTABLE_TYPES).toEqual([
      "host","runtime","container","database","monitoring_service","ai_service",
      "application","subnet","gateway","network_interface","docker_host","router",
    ]);
  });
});
