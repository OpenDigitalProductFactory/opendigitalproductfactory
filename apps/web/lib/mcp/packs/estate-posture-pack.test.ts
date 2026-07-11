import { beforeEach, describe, expect, it, vi } from "vitest";

const estate = vi.hoisted(() => ({
  resolveEstateEntity: vi.fn(),
  summarizeProductEstate: vi.fn(),
  summarizeDiscoveryOperations: vi.fn(),
  loadEstateBlastRadius: vi.fn(),
}));
vi.mock("@/lib/estate/estate-tooling", () => estate);

import { estatePosturePack } from "./estate-posture-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "summarize_estate_posture",
  "review_estate_identity",
  "validate_version_confidence",
  "explain_blast_radius",
];

// A fully-resolved estate item with every label the handlers read.
const RESOLVED_ITEM = {
  id: "item-1",
  name: "Acme DB",
  supportSummaryLabel: "supported",
  advisorySummaryLabel: "no advisories",
  freshnessLabel: "evidence fresh",
  postureBadges: ["ok"],
  blastRadiusLabel: "2 downstream",
  identityConfidenceLabel: "high confidence",
  identityLabel: "PostgreSQL",
  manufacturerLabel: "PostgreSQL Global Dev Group",
  versionLabel: "16.2",
  versionSourceLabel: "normalized",
  versionConfidenceLabel: "high",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("estate-posture pack — registration", () => {
  it("exposes exactly the four estate posture / identity tools", () => {
    expect(estatePosturePack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(estatePosturePack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("all tools are read-only", () => {
    for (const d of estatePosturePack.definitions) {
      expect(d.sideEffect).toBe(false);
    }
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of estatePosturePack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grants mirror agent-grants: every tool needs registry_read", () => {
    for (const t of EXPECTED_TOOLS) {
      expect(estatePosturePack.grants[t]).toEqual(["registry_read"]);
      expect(isToolAllowedByGrants(t, ["registry_read"])).toBe(true);
    }
  });
});

describe("estate-posture pack — handler behavior (delegation preserved)", () => {
  it("summarize_estate_posture returns the resolved item's posture labels", async () => {
    estate.resolveEstateEntity.mockResolvedValue({ kind: "resolved", item: RESOLVED_ITEM });
    const res = await estatePosturePack.handlers.summarize_estate_posture({ entityId: "item-1" }, "u1", { routeContext: "/platform/x" });
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("item-1");
    expect(res.message).toContain("Acme DB: supported");
    expect(estate.resolveEstateEntity).toHaveBeenCalledWith(
      { entityId: "item-1", entityKey: undefined, entityName: undefined },
      "/platform/x",
    );
  });

  it("summarize_estate_posture reports ambiguity without falling through", async () => {
    estate.resolveEstateEntity.mockResolvedValue({
      kind: "ambiguous",
      matches: [{ name: "A", entityKey: "a" }, { name: "B", entityKey: "b" }],
    });
    const res = await estatePosturePack.handlers.summarize_estate_posture({ entityName: "db" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("A (a), B (b)");
    expect(estate.summarizeProductEstate).not.toHaveBeenCalled();
  });

  it("summarize_estate_posture falls back to the product estate summary when nothing resolves", async () => {
    estate.resolveEstateEntity.mockResolvedValue({ kind: "missing", reason: "no id" });
    estate.summarizeProductEstate.mockResolvedValue({
      productId: "p-1",
      productName: "Acme",
      itemCount: 3,
      openIssueCount: 1,
      unknownSupportCount: 0,
      lowIdentityConfidenceCount: 2,
    });
    const res = await estatePosturePack.handlers.summarize_estate_posture({}, "u1");
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("p-1");
    expect(res.message).toContain("3 estate items");
  });

  it("summarize_estate_posture falls back to discovery operations when there is no product estate", async () => {
    estate.resolveEstateEntity.mockResolvedValue({ kind: "missing", reason: "no id" });
    estate.summarizeProductEstate.mockResolvedValue(null);
    estate.summarizeDiscoveryOperations.mockResolvedValue({ needsReviewCount: 5 });
    const res = await estatePosturePack.handlers.summarize_estate_posture({}, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("5 items need review");
  });

  it("review_estate_identity returns identity labels for a resolved item", async () => {
    estate.resolveEstateEntity.mockResolvedValue({ kind: "resolved", item: RESOLVED_ITEM });
    const res = await estatePosturePack.handlers.review_estate_identity({ entityKey: "k" }, "u1");
    expect(res.success).toBe(true);
    expect((res.data as { manufacturerLabel: string }).manufacturerLabel).toBe("PostgreSQL Global Dev Group");
  });

  it("review_estate_identity surfaces a missing item's reason", async () => {
    estate.resolveEstateEntity.mockResolvedValue({ kind: "missing", reason: "not found" });
    const res = await estatePosturePack.handlers.review_estate_identity({ entityId: "x" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("not found");
  });

  it("validate_version_confidence reports the version confidence label", async () => {
    estate.resolveEstateEntity.mockResolvedValue({ kind: "resolved", item: RESOLVED_ITEM });
    const res = await estatePosturePack.handlers.validate_version_confidence({ entityId: "item-1" }, "u1");
    expect(res.success).toBe(true);
    expect((res.data as { versionConfidenceLabel: string }).versionConfidenceLabel).toBe("high");
    expect(res.message).toContain("Current version shown as 16.2");
  });

  it("explain_blast_radius loads the dependency model for a resolved item", async () => {
    estate.resolveEstateEntity.mockResolvedValue({ kind: "resolved", item: RESOLVED_ITEM });
    estate.loadEstateBlastRadius.mockResolvedValue({ upstream: ["a"], downstream: ["b", "c"] });
    const res = await estatePosturePack.handlers.explain_blast_radius({ entityId: "item-1" }, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("2 downstream dependencies and 1 upstream dependency");
    expect(estate.loadEstateBlastRadius).toHaveBeenCalledWith("item-1");
  });

  it("explain_blast_radius fails when the item cannot be loaded for analysis", async () => {
    estate.resolveEstateEntity.mockResolvedValue({ kind: "resolved", item: RESOLVED_ITEM });
    estate.loadEstateBlastRadius.mockResolvedValue(null);
    const res = await estatePosturePack.handlers.explain_blast_radius({ entityId: "item-1" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Estate item not found");
  });
});
