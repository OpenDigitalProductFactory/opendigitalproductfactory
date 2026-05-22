// Phase 0 Task 0.1 — typed constants for wiki page kinds, statuses, and
// principle-only taxonomy. Single source of truth imported by seed, lint, MCP
// schemas, retrieval, and UI. Spec: docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md
// Plan: docs/superpowers/plans/2026-05-12-principles-as-wiki-kind.md (Phase 0)

import { describe, expect, it } from "vitest";
import {
  WIKI_PAGE_KINDS,
  WIKI_PAGE_STATUSES,
  PRINCIPLE_TIERS,
  PRINCIPLE_APPLIES_TO,
  PRINCIPLE_CONSUMER_ARCHETYPES,
  PRINCIPLE_CONSUMER_CONTEXT_EXAMPLES,
  PRINCIPLE_DIMENSIONS,
  PRINCIPLE_TIER_DEFAULT_WEIGHT,
  PRINCIPLE_TIER_CAPS,
  PRINCIPLE_DECIDE_DEFAULTS,
  isWikiPageKind,
  isWikiPageStatus,
  isPrincipleTier,
  isPrincipleAppliesTo,
  isPrincipleConsumerArchetype,
  isPrincipleConsumerContextSlug,
  isPrincipleDimension,
} from "./wiki-taxonomy";

describe("wiki-taxonomy: WIKI_PAGE_KINDS", () => {
  it("includes the 8 expected kinds in the documented order", () => {
    expect(WIKI_PAGE_KINDS).toEqual([
      "entity",
      "summary",
      "decision",
      "runbook",
      "index",
      "stance",
      "heuristic",
      "principle",
    ]);
  });

  it("preserves the 7 pre-existing kinds from EP-WIKI-001 unchanged", () => {
    expect(WIKI_PAGE_KINDS).toContain("entity");
    expect(WIKI_PAGE_KINDS).toContain("summary");
    expect(WIKI_PAGE_KINDS).toContain("decision");
    expect(WIKI_PAGE_KINDS).toContain("runbook");
    expect(WIKI_PAGE_KINDS).toContain("index");
    expect(WIKI_PAGE_KINDS).toContain("stance");
    expect(WIKI_PAGE_KINDS).toContain("heuristic");
  });

  it("adds principle as the 8th kind", () => {
    expect(WIKI_PAGE_KINDS).toContain("principle");
    expect(WIKI_PAGE_KINDS).toHaveLength(8);
  });
});

describe("wiki-taxonomy: WIKI_PAGE_STATUSES", () => {
  it("matches the EP-WIKI-001 lifecycle", () => {
    expect(WIKI_PAGE_STATUSES).toEqual([
      "draft",
      "published",
      "review-needed",
      "archived",
    ]);
  });
});

describe("wiki-taxonomy: PRINCIPLE_TIERS", () => {
  it("has exactly three tiers in descending weight order", () => {
    expect(PRINCIPLE_TIERS).toEqual(["commandment", "core", "contextual"]);
  });
});

describe("wiki-taxonomy: PRINCIPLE_APPLIES_TO", () => {
  it("covers the three governed populations from spec section 5.3", () => {
    expect(PRINCIPLE_APPLIES_TO).toEqual([
      "in_platform_coworker",
      "external_coding_agent",
      "human",
    ]);
  });
});

describe("wiki-taxonomy: PRINCIPLE_CONSUMER_ARCHETYPES", () => {
  it("orders archetypes from broadest to most-scoped per spec section 8A", () => {
    expect(PRINCIPLE_CONSUMER_ARCHETYPES).toEqual([
      "universal",
      "ai-coworker-universal",
      "generalist",
      "specialist",
      "route-domain-specific",
    ]);
  });

  it("contains exactly five archetypes", () => {
    expect(PRINCIPLE_CONSUMER_ARCHETYPES).toHaveLength(5);
  });

  it("places universal first so retrieval pulls broadest-scope principles first", () => {
    expect(PRINCIPLE_CONSUMER_ARCHETYPES[0]).toBe("universal");
  });

  it("places route-domain-specific last so route filtering is the narrowing step", () => {
    expect(
      PRINCIPLE_CONSUMER_ARCHETYPES[PRINCIPLE_CONSUMER_ARCHETYPES.length - 1],
    ).toBe("route-domain-specific");
  });
});

describe("wiki-taxonomy: PRINCIPLE_CONSUMER_CONTEXT_EXAMPLES", () => {
  it("documents at least the seven canonical route/domain contexts from spec section 8A", () => {
    for (const slug of [
      "build-studio",
      "marketing",
      "compliance",
      "discovery",
      "finance",
      "storefront",
      "portfolio",
    ]) {
      expect(PRINCIPLE_CONSUMER_CONTEXT_EXAMPLES).toContain(slug);
    }
  });

  it("places build-studio first since it is the most-cited consumer context in the kernel", () => {
    expect(PRINCIPLE_CONSUMER_CONTEXT_EXAMPLES[0]).toBe("build-studio");
  });
});

describe("wiki-taxonomy: PRINCIPLE_DIMENSIONS", () => {
  it("contains the original ten spec section 10 dimensions plus extensions", () => {
    const original = [
      "long_term_maintainability",
      "blast_radius",
      "reusability",
      "evidence_density",
      "human_cognitive_load",
      "capacity_utilization",
      "governance_compliance",
      "public_safety",
      "speed_to_value",
      "schema_grounding",
    ];
    // Each original dimension must be present (order-stable prefix)
    for (const d of original) {
      expect(PRINCIPLE_DIMENSIONS).toContain(d);
    }
  });

  it("contains at least the ten starter dimensions", () => {
    expect(PRINCIPLE_DIMENSIONS.length).toBeGreaterThanOrEqual(10);
  });
});

describe("wiki-taxonomy: PRINCIPLE_TIER_DEFAULT_WEIGHT", () => {
  it("encodes the tier weight hierarchy from spec section 5.1", () => {
    expect(PRINCIPLE_TIER_DEFAULT_WEIGHT.commandment).toBe(1.0);
    expect(PRINCIPLE_TIER_DEFAULT_WEIGHT.core).toBe(0.4);
    expect(PRINCIPLE_TIER_DEFAULT_WEIGHT.contextual).toBe(0.1);
  });

  it("makes a single commandment outweigh ten contextual at peak alignment", () => {
    expect(
      PRINCIPLE_TIER_DEFAULT_WEIGHT.commandment,
    ).toBeGreaterThanOrEqual(PRINCIPLE_TIER_DEFAULT_WEIGHT.contextual * 10);
  });
});

describe("wiki-taxonomy: PRINCIPLE_TIER_CAPS", () => {
  // Commandment cap removed 2026-05-22 per scope-refactor plan: commandments
  // are about conflict-resolution priority (weight 1.0 always wins), not
  // scarcity. See docs/superpowers/plans/2026-05-22-principle-scope-refactor.md.
  it("leaves commandments uncapped (null)", () => {
    expect(PRINCIPLE_TIER_CAPS.commandment).toBeNull();
  });

  it("soft-caps core at 30", () => {
    expect(PRINCIPLE_TIER_CAPS.core).toBe(30);
  });

  it("leaves contextual uncapped (null)", () => {
    expect(PRINCIPLE_TIER_CAPS.contextual).toBeNull();
  });
});

describe("wiki-taxonomy: PRINCIPLE_DECIDE_DEFAULTS", () => {
  it("matches the principle_decide defaults from spec section 11", () => {
    expect(PRINCIPLE_DECIDE_DEFAULTS.maxPrinciples).toBe(20);
    expect(PRINCIPLE_DECIDE_DEFAULTS.tieMargin).toBe(0.2);
    expect(PRINCIPLE_DECIDE_DEFAULTS.contextualSimilarityThreshold).toBe(0.75);
    expect(PRINCIPLE_DECIDE_DEFAULTS.semanticFallbackWarnRatio).toBe(0.4);
  });
});

describe("wiki-taxonomy: isWikiPageKind", () => {
  it("accepts every documented kind", () => {
    for (const kind of WIKI_PAGE_KINDS) {
      expect(isWikiPageKind(kind)).toBe(true);
    }
  });

  it("rejects unknown strings", () => {
    expect(isWikiPageKind("article")).toBe(false);
    expect(isWikiPageKind("")).toBe(false);
    expect(isWikiPageKind("PRINCIPLE")).toBe(false); // case-sensitive
  });

  it("rejects non-string inputs", () => {
    expect(isWikiPageKind(null)).toBe(false);
    expect(isWikiPageKind(undefined)).toBe(false);
    expect(isWikiPageKind(42)).toBe(false);
    expect(isWikiPageKind({})).toBe(false);
  });
});

describe("wiki-taxonomy: isWikiPageStatus", () => {
  it("accepts every documented status", () => {
    for (const status of WIKI_PAGE_STATUSES) {
      expect(isWikiPageStatus(status)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isWikiPageStatus("pending")).toBe(false);
    expect(isWikiPageStatus(null)).toBe(false);
  });
});

describe("wiki-taxonomy: isPrincipleTier", () => {
  it("accepts every documented tier", () => {
    for (const tier of PRINCIPLE_TIERS) {
      expect(isPrincipleTier(tier)).toBe(true);
    }
  });

  it("rejects unknown tiers and non-strings", () => {
    expect(isPrincipleTier("situational")).toBe(false);
    expect(isPrincipleTier("")).toBe(false);
    expect(isPrincipleTier(null)).toBe(false);
    expect(isPrincipleTier(undefined)).toBe(false);
  });
});

describe("wiki-taxonomy: isPrincipleAppliesTo", () => {
  it("accepts every documented population", () => {
    for (const population of PRINCIPLE_APPLIES_TO) {
      expect(isPrincipleAppliesTo(population)).toBe(true);
    }
  });

  it("rejects unknown populations", () => {
    expect(isPrincipleAppliesTo("agent")).toBe(false);
    expect(isPrincipleAppliesTo("all")).toBe(false); // `all` is not in the registry per spec section 5.3
    expect(isPrincipleAppliesTo(null)).toBe(false);
  });
});

describe("wiki-taxonomy: isPrincipleConsumerArchetype", () => {
  it("accepts every documented archetype", () => {
    for (const archetype of PRINCIPLE_CONSUMER_ARCHETYPES) {
      expect(isPrincipleConsumerArchetype(archetype)).toBe(true);
    }
  });

  it("rejects unknown archetypes and non-strings", () => {
    expect(isPrincipleConsumerArchetype("aico")).toBe(false);
    expect(isPrincipleConsumerArchetype("Universal")).toBe(false); // case-sensitive
    expect(isPrincipleConsumerArchetype("")).toBe(false);
    expect(isPrincipleConsumerArchetype(null)).toBe(false);
    expect(isPrincipleConsumerArchetype(undefined)).toBe(false);
    expect(isPrincipleConsumerArchetype(0)).toBe(false);
  });
});

describe("wiki-taxonomy: isPrincipleConsumerContextSlug", () => {
  it("accepts every documented example slug", () => {
    for (const slug of PRINCIPLE_CONSUMER_CONTEXT_EXAMPLES) {
      expect(isPrincipleConsumerContextSlug(slug)).toBe(true);
    }
  });

  it("accepts arbitrary kebab-case slugs since contexts are governed slugs, not a closed enum", () => {
    expect(isPrincipleConsumerContextSlug("ops-runbooks")).toBe(true);
    expect(isPrincipleConsumerContextSlug("hr")).toBe(true);
    expect(isPrincipleConsumerContextSlug("ai-routing")).toBe(true);
  });

  it("rejects malformed slugs", () => {
    expect(isPrincipleConsumerContextSlug("")).toBe(false);
    expect(isPrincipleConsumerContextSlug("Build-Studio")).toBe(false); // uppercase
    expect(isPrincipleConsumerContextSlug("build_studio")).toBe(false); // underscore
    expect(isPrincipleConsumerContextSlug("build studio")).toBe(false); // space
    expect(isPrincipleConsumerContextSlug("-leading")).toBe(false); // leading hyphen
    expect(isPrincipleConsumerContextSlug("trailing-")).toBe(false); // trailing hyphen
    expect(isPrincipleConsumerContextSlug("double--hyphen")).toBe(false);
    expect(isPrincipleConsumerContextSlug("build.studio")).toBe(false); // dot
  });

  it("rejects non-string inputs", () => {
    expect(isPrincipleConsumerContextSlug(null)).toBe(false);
    expect(isPrincipleConsumerContextSlug(undefined)).toBe(false);
    expect(isPrincipleConsumerContextSlug(42)).toBe(false);
    expect(isPrincipleConsumerContextSlug({})).toBe(false);
  });
});

describe("wiki-taxonomy: isPrincipleDimension", () => {
  it("accepts every dimension in the registry", () => {
    for (const dimension of PRINCIPLE_DIMENSIONS) {
      expect(isPrincipleDimension(dimension)).toBe(true);
    }
  });

  it("rejects unknown dimensions", () => {
    expect(isPrincipleDimension("fictional_axis")).toBe(false);
    expect(isPrincipleDimension("long_term")).toBe(false); // partial match should fail
    expect(isPrincipleDimension(null)).toBe(false);
  });
});
