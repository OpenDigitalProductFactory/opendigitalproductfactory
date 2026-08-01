import { describe, it, expect } from "vitest";
import {
  resolveLifecycle,
  deriveCurrency,
  deriveSupportEndDate,
  deriveManifestationClass,
  deriveTemporalPerspective,
  isLegalStageTransition,
  isLegalStatusTransition,
  LIFECYCLE_STAGES,
  REALIZATION_STAGES,
} from "./lifecycle";
import {
  parseGovernedThingRef,
  isGovernedThingKind,
  governedThingRefKey,
  parseGovernedThingRefKey,
  GOVERNED_THING_KINDS,
} from "./governed-thing-ref";

describe("deriveManifestationClass", () => {
  it("treats actual realization as manifested", () => {
    expect(deriveManifestationClass("actual")).toBe("manifested");
  });
  it("treats conceptual/logical as logical", () => {
    expect(deriveManifestationClass("conceptual")).toBe("logical");
    expect(deriveManifestationClass("logical")).toBe("logical");
    expect(deriveManifestationClass(null)).toBe("logical");
  });
  it("honours an explicit hint", () => {
    expect(deriveManifestationClass("logical", "manifested")).toBe("manifested");
  });
});

describe("deriveTemporalPerspective", () => {
  it("classifies retirement stage as past", () => {
    expect(
      deriveTemporalPerspective({ realizationStage: "actual", lifecycleStage: "retirement", lifecycleStatus: "inactive", freshness: null }),
    ).toBe("past");
  });
  it("classifies observed-retired freshness as past even at production", () => {
    expect(
      deriveTemporalPerspective({ realizationStage: "actual", lifecycleStage: "production", lifecycleStatus: "active", freshness: "retired" }),
    ).toBe("past");
  });
  it("classifies design intent as future", () => {
    expect(
      deriveTemporalPerspective({ realizationStage: "logical", lifecycleStage: "design", lifecycleStatus: "draft", freshness: null }),
    ).toBe("future");
    expect(
      deriveTemporalPerspective({ realizationStage: "conceptual", lifecycleStage: "plan", lifecycleStatus: "draft", freshness: null }),
    ).toBe("future");
  });
  it("classifies inactive logical things as past without fake freshness", () => {
    expect(
      deriveTemporalPerspective({ realizationStage: "logical", lifecycleStage: "production", lifecycleStatus: "inactive", freshness: null }),
    ).toBe("past");
  });
  it("classifies actual+active production as current", () => {
    expect(
      deriveTemporalPerspective({ realizationStage: "actual", lifecycleStage: "production", lifecycleStatus: "active", freshness: "fresh" }),
    ).toBe("current");
  });
});

describe("deriveCurrency", () => {
  const now = new Date("2026-06-07T00:00:00Z");
  it("returns end-of-life when EOL date is in the past", () => {
    expect(deriveCurrency({ supportEndsAt: "2026-01-01T00:00:00Z", now })).toBe("end-of-life");
  });
  it("returns approaching-eol within the window", () => {
    expect(deriveCurrency({ supportEndsAt: "2026-08-01T00:00:00Z", now })).toBe("approaching-eol");
  });
  it("returns current when EOL date is far out", () => {
    expect(deriveCurrency({ supportEndsAt: "2030-01-01T00:00:00Z", now })).toBe("current");
  });
  it("maps supportStatus when no date is present", () => {
    expect(deriveCurrency({ supportStatus: "supported" })).toBe("current");
    expect(deriveCurrency({ supportStatus: "deprecated" })).toBe("approaching-eol");
    expect(deriveCurrency({ supportStatus: "end-of-life" })).toBe("end-of-life");
    expect(deriveCurrency({ supportStatus: "unsupported" })).toBe("unsupported");
  });
  it("returns null for unknown/absent support signal", () => {
    expect(deriveCurrency({ supportStatus: "unknown" })).toBeNull();
    expect(deriveCurrency({})).toBeNull();
  });
  it("EOL date overrides supportStatus", () => {
    expect(deriveCurrency({ supportStatus: "supported", supportEndsAt: "2026-01-01T00:00:00Z", now })).toBe("end-of-life");
  });
});

describe("deriveSupportEndDate", () => {
  it("uses the canonical catalog milestone hierarchy", () => {
    expect(deriveSupportEndDate([
      { milestone: "eol", date: "2027-01-01", confidence: 0.9 },
      { milestone: "extended_support_end", date: "2028-01-01", confidence: 0.8 },
    ])?.toISOString()).toContain("2028-01-01");
  });

  it("prefers higher-confidence evidence within one milestone", () => {
    expect(deriveSupportEndDate([
      { milestone: "eol", date: "2027-01-01", confidence: 0.5 },
      { milestone: "eol", date: "2029-01-01", confidence: 0.9 },
    ])?.toISOString()).toContain("2029-01-01");
  });
});

describe("legal transitions", () => {
  it("allows forward stage progression and same-stage", () => {
    expect(isLegalStageTransition("plan", "design")).toBe(true);
    expect(isLegalStageTransition("production", "retirement")).toBe(true);
    expect(isLegalStageTransition("design", "production")).toBe(true);
    expect(isLegalStageTransition("production", "production")).toBe(true);
  });
  it("rejects backward stage progression and retirement exit", () => {
    expect(isLegalStageTransition("production", "design")).toBe(false);
    expect(isLegalStageTransition("retirement", "production")).toBe(false);
  });
  it("governs status transitions", () => {
    expect(isLegalStatusTransition("draft", "active")).toBe(true);
    expect(isLegalStatusTransition("active", "inactive")).toBe(true);
    expect(isLegalStatusTransition("inactive", "active")).toBe(true);
  });
});

describe("resolveLifecycle — unifies heterogeneous models onto common axes", () => {
  it("EaElement (actual) → manifested/current", () => {
    const r = resolveLifecycle({ kind: "EaElement", lifecycleStage: "production", lifecycleStatus: "active", refinementLevel: "actual" });
    expect(r.realizationStage).toBe("actual");
    expect(r.manifestationClass).toBe("manifested");
    expect(r.temporalPerspective).toBe("current");
  });

  it("EaElement (design/logical) → future, no freshness/currency", () => {
    const r = resolveLifecycle({ kind: "EaElement", lifecycleStage: "design", lifecycleStatus: "draft", refinementLevel: "logical" });
    expect(r.temporalPerspective).toBe("future");
    expect(r.manifestationClass).toBe("logical");
    expect(r.freshness).toBeNull();
    expect(r.currency).toBeNull();
  });

  it("InventoryEntity (active, deprecated) → current/manifested with approaching-eol currency", () => {
    const r = resolveLifecycle({ kind: "InventoryEntity", status: "active", supportStatus: "deprecated" });
    expect(r.realizationStage).toBe("actual");
    expect(r.lifecycleStage).toBe("production");
    expect(r.freshness).toBe("fresh");
    expect(r.currency).toBe("approaching-eol");
    expect(r.temporalPerspective).toBe("current");
  });

  it("InventoryEntity derives currency from CatalogLifecycleMilestone evidence", () => {
    const r = resolveLifecycle({
      kind: "InventoryEntity",
      status: "active",
      supportStatus: "supported",
      supportMilestones: [{ milestone: "eol", date: "2026-01-01", confidence: 0.9 }],
      now: new Date("2026-06-07T00:00:00Z"),
    });
    expect(r.currency).toBe("end-of-life");
  });

  it("InventoryEntity (inactive) → past/retired", () => {
    const r = resolveLifecycle({ kind: "InventoryEntity", status: "inactive", supportStatus: "unknown" });
    expect(r.lifecycleStage).toBe("retirement");
    expect(r.freshness).toBe("retired");
    expect(r.temporalPerspective).toBe("past");
  });

  it("InventoryEntity honours an explicit stale freshness signal", () => {
    const r = resolveLifecycle({ kind: "InventoryEntity", status: "active", freshness: "stale" });
    expect(r.freshness).toBe("stale");
    expect(r.temporalPerspective).toBe("current");
  });

  it("ServiceOffering (active) → logical/current, never carries freshness", () => {
    const r = resolveLifecycle({ kind: "ServiceOffering", status: "active" });
    expect(r.manifestationClass).toBe("logical");
    expect(r.freshness).toBeNull();
    expect(r.currency).toBeNull();
    expect(r.temporalPerspective).toBe("current");
  });

  it("ServiceOffering (discontinued) → past", () => {
    expect(resolveLifecycle({ kind: "ServiceOffering", status: "discontinued" }).temporalPerspective).toBe("past");
  });

  it("Document (published) → current; (archived) → past", () => {
    expect(resolveLifecycle({ kind: "Document", currentState: "published" }).temporalPerspective).toBe("current");
    expect(resolveLifecycle({ kind: "Document", currentState: "archived" }).temporalPerspective).toBe("past");
  });

  it("DigitalProduct maps stage→realization", () => {
    expect(resolveLifecycle({ kind: "DigitalProduct", lifecycleStage: "plan", lifecycleStatus: "draft" }).realizationStage).toBe("conceptual");
    expect(resolveLifecycle({ kind: "DigitalProduct", lifecycleStage: "production", lifecycleStatus: "active" }).realizationStage).toBe("actual");
  });

  it("BusinessCapability is always logical (superseded, not retired-with-freshness)", () => {
    const r = resolveLifecycle({ kind: "BusinessCapability", status: "active" });
    expect(r.manifestationClass).toBe("logical");
    expect(r.freshness).toBeNull();
  });

  it("Agent uses lifecycleStage directly", () => {
    expect(resolveLifecycle({ kind: "Agent", lifecycleStage: "retirement" }).temporalPerspective).toBe("past");
    expect(resolveLifecycle({ kind: "Agent", lifecycleStage: "production" }).temporalPerspective).toBe("current");
  });

  it("coerces unknown stage/status to safe defaults", () => {
    const r = resolveLifecycle({ kind: "EaElement", lifecycleStage: "bogus", lifecycleStatus: "nonsense", refinementLevel: "weird" });
    expect((LIFECYCLE_STAGES as readonly string[]).includes(r.lifecycleStage)).toBe(true);
    expect(r.realizationStage).toBeNull();
  });

  it("invariant: logical things never report freshness or currency", () => {
    for (const input of [
      { kind: "ServiceOffering", status: "active" },
      { kind: "Document", currentState: "published" },
      { kind: "BusinessCapability", status: "active" },
      { kind: "EaElement", lifecycleStage: "design", lifecycleStatus: "draft", refinementLevel: "conceptual" },
    ] as const) {
      const r = resolveLifecycle(input);
      expect(r.freshness).toBeNull();
      expect(r.currency).toBeNull();
    }
  });
});

describe("governed-thing-ref allowlist", () => {
  it("accepts known kinds and rejects unknown", () => {
    expect(isGovernedThingKind("EaElement")).toBe(true);
    expect(isGovernedThingKind("RandomTable")).toBe(false);
    expect(isGovernedThingKind(42)).toBe(false);
  });

  it("parses a valid ref and trims the id", () => {
    expect(parseGovernedThingRef("DigitalProduct", "  abc  ")).toEqual({ kind: "DigitalProduct", id: "abc" });
  });

  it("rejects dangling refs", () => {
    expect(parseGovernedThingRef("NotAKind", "abc")).toBeNull();
    expect(parseGovernedThingRef("EaElement", "")).toBeNull();
    expect(parseGovernedThingRef("EaElement", "   ")).toBeNull();
    expect(parseGovernedThingRef("EaElement", 5)).toBeNull();
  });

  it("round-trips the composite key", () => {
    const ref = { kind: "InventoryEntity", id: "clx1" } as const;
    const key = governedThingRefKey(ref);
    expect(key).toBe("InventoryEntity:clx1");
    expect(parseGovernedThingRefKey(key)).toEqual(ref);
  });

  it("handles ids containing colons in the key round-trip", () => {
    const ref = { kind: "InventoryEntity", id: "host:port:42" } as const;
    expect(parseGovernedThingRefKey(governedThingRefKey(ref))).toEqual(ref);
  });

  it("every governed-thing kind is resolvable by resolveLifecycle", () => {
    // Coverage sanity — keeps the allowlist and the resolver in lock-step.
    expect(GOVERNED_THING_KINDS.length).toBe(7);
    expect(REALIZATION_STAGES.length).toBe(3);
  });
});
