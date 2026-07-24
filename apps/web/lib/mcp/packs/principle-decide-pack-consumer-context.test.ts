// BI-5BB1A364: consumer-context retrieval filter + contextless-caller
// attenuation.
//
// Kept in its own file (rather than folded into principle-decide-pack.test.ts)
// so this addition doesn't grow that file past its module-size ratchet
// ceiling (BI-OPT-RATCHETS) — a `vi.mock` factory must live in the same file
// that imports the mocked module, so the setup below duplicates the relevant
// subset of principle-decide-pack.test.ts's mocking rather than sharing it.
//
// Root cause: listPrinciplesByTier never filtered on principleConsumerContexts,
// so a route-domain-specific commandment like no-hardcoded-colors — a UI/CSS
// rule whose vector carries only generic axes (long_term_maintainability,
// reusability, schema_grounding) — voted at full commandment weight (1.0) on
// every decision, including ones with no UI content. These pin: (1) a
// contextless caller attenuates rather than excludes such a commandment; (2) a
// caller who declares a MATCHING context keeps it at full weight; (3) a
// non-route-domain commandment is never touched by this lever; (4)
// consumerContexts is validated and threaded to listPrinciplesByTier the same
// way ringScope is.

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  listPrinciplesByTier: vi.fn(),
  organizationFindFirst: vi.fn(),
  wikiPageFindMany: vi.fn(),
}));
const wiki = vi.hoisted(() => ({
  searchWikiPages: vi.fn(),
  decide: vi.fn(),
  principleMatchesRingScope: vi.fn(),
  generateEmbedding: vi.fn(),
  isEmbeddingAvailable: vi.fn(),
}));
const decision = vi.hoisted(() => ({
  resolveDecisionCallerContext: vi.fn(),
  recordKernelConsultInteraction: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    organization: { findFirst: (...a: unknown[]) => db.organizationFindFirst(...a) },
    wikiPage: { findMany: (...a: unknown[]) => db.wikiPageFindMany(...a) },
  },
  listPrinciplesByTier: (...a: unknown[]) => db.listPrinciplesByTier(...a),
  PRINCIPLE_DECIDE_DEFAULTS: {
    maxPrinciples: 20,
    tieMargin: 0.2,
    contextualSimilarityThreshold: 0.5,
    semanticFallbackWarnRatio: 0.5,
  },
}));
vi.mock("@dpf/db/wiki-taxonomy", async (importActual) => ({
  ...(await importActual<typeof import("@dpf/db/wiki-taxonomy")>()),
}));
vi.mock("@/lib/wiki/embeddings", () => ({
  searchWikiPages: (...a: unknown[]) => wiki.searchWikiPages(...a),
}));
vi.mock("@/lib/wiki/principle-decide", () => ({
  decide: (...a: unknown[]) => wiki.decide(...a),
}));
vi.mock("@/lib/wiki/calling-ring-map", () => ({
  principleMatchesRingScope: (...a: unknown[]) => wiki.principleMatchesRingScope(...a),
}));
vi.mock("@/lib/inference/embedding", () => ({
  generateEmbedding: (...a: unknown[]) => wiki.generateEmbedding(...a),
  isEmbeddingAvailable: (...a: unknown[]) => wiki.isEmbeddingAvailable(...a),
}));
vi.mock("@/lib/decision/caller-context", () => ({
  resolveDecisionCallerContext: (...a: unknown[]) => decision.resolveDecisionCallerContext(...a),
}));
vi.mock("@/lib/decision/kernel-consult-ledger", () => ({
  recordKernelConsultInteraction: (...a: unknown[]) => decision.recordKernelConsultInteraction(...a),
}));

import { principleDecidePack } from "./principle-decide-pack";

beforeEach(() => {
  vi.clearAllMocks();
  db.listPrinciplesByTier.mockResolvedValue([]);
  db.organizationFindFirst.mockResolvedValue({ id: "org-1" });
  wiki.searchWikiPages.mockResolvedValue([]);
  db.wikiPageFindMany.mockResolvedValue([]);
  wiki.generateEmbedding.mockResolvedValue(undefined);
  wiki.isEmbeddingAvailable.mockResolvedValue(true);
  wiki.principleMatchesRingScope.mockReturnValue(true);
  decision.resolveDecisionCallerContext.mockResolvedValue({
    governingProfileId: "prof-1",
    governingProfileKind: "platform_kernel",
    resolvedVia: "default",
  });
  decision.recordKernelConsultInteraction.mockResolvedValue({ interactionId: "int-1" });
});

describe("principle-decide pack — consumer-context attenuation (BI-5BB1A364)", () => {
  // Mirrors the BI's own worked example, and the live kernel corpus rows
  // (docs/founder-kernel/wiki/principles/{no-hardcoded-colors,research-and-use-standards}.md):
  // long_term_maintainability is spine; reusability + schema_grounding are
  // profession-local to software-engineer (BI-AA7D80FE / #3481).
  const NO_HARDCODED_COLORS = {
    id: "cmd-no-hardcoded-colors",
    title: "No Hardcoded Colors",
    principleTier: "commandment",
    principleDirection: "use design tokens, never literal color values",
    principleConsumerArchetype: "route-domain-specific",
    principleConsumerContexts: ["ui"],
    principleDimensionVector: {
      long_term_maintainability: 0.9,
      reusability: 0.7,
      schema_grounding: 0.5,
    },
  };
  const RESEARCH_AND_USE_STANDARDS = {
    id: "cmd-research-and-use-standards",
    title: "Research And Use Standards",
    principleTier: "commandment",
    principleDirection: "ground decisions in established standards",
    principleConsumerArchetype: "universal",
    principleConsumerContexts: [],
    principleDimensionVector: {
      schema_grounding: 0.9,
      long_term_maintainability: 0.7,
      reusability: 0.6,
    },
  };

  const invoke = (extra: Record<string, unknown> = {}) =>
    principleDecidePack.handlers.principle_decide(
      {
        context: "should the platform kernel split instruction-plane state?",
        options: [
          {
            id: "split",
            description: "split the instruction plane",
            features: { long_term_maintainability: 0.8, blast_radius: 0.3 },
          },
        ],
        callingPopulation: "external_coding_agent",
        ...extra,
      },
      "u1",
    );

  const scoredWeight = (id: string) =>
    (wiki.decide.mock.calls[0][1] as Array<{ id: string; weight: number }>).find(
      (p) => p.id === id,
    )?.weight;

  beforeEach(() => {
    wiki.decide.mockReturnValue({
      recommendation: { optionId: "split", confidence: "high", composite: 1 },
      scores: [{ optionId: "split", composite: 1 }],
      flags: [],
      reasoning: "clear winner",
    });
  });

  it("attenuates a route-domain-specific commandment when the caller declares no context", async () => {
    db.listPrinciplesByTier.mockResolvedValue([NO_HARDCODED_COLORS]);

    await invoke();

    const weight = scoredWeight("cmd-no-hardcoded-colors");
    expect(weight).toBeDefined();
    // ROUTE_DOMAIN_CONTEXTLESS_ATTENUATION (0.3) × profession-local
    // attenuation factor for a vector that is 1.2/2.1 profession-local
    // (reusability + schema_grounding out of the 2.1 total magnitude):
    // 0.3 × (1 - (1.2/2.1) × 0.5) ≈ 0.2143.
    expect(weight).toBeCloseTo(0.2142857, 5);
    // Strictly less than full commandment weight — the defect this closes.
    expect(weight!).toBeLessThan(1.0);
  });

  it("does NOT attenuate a non-route-domain-specific commandment, even contextless", async () => {
    db.listPrinciplesByTier.mockResolvedValue([RESEARCH_AND_USE_STANDARDS]);

    await invoke();

    // Universal archetype is untouched by the route-domain lever — the
    // BI's own contrast case (no-hardcoded-colors must rank BELOW this).
    expect(scoredWeight("cmd-research-and-use-standards")).toBe(1.0);
  });

  it("a contextless-attenuated route-domain commandment no longer out-ranks a universal one on the same weight axis", async () => {
    db.listPrinciplesByTier.mockResolvedValue([
      NO_HARDCODED_COLORS,
      RESEARCH_AND_USE_STANDARDS,
    ]);

    await invoke();

    const uiWeight = scoredWeight("cmd-no-hardcoded-colors")!;
    const standardsWeight = scoredWeight("cmd-research-and-use-standards")!;
    expect(uiWeight).toBeLessThan(standardsWeight);
  });

  it("keeps full weight when the caller declares a MATCHING consumerContext", async () => {
    db.listPrinciplesByTier.mockResolvedValue([NO_HARDCODED_COLORS]);

    await invoke({ consumerContexts: ["ui"] });

    expect(db.listPrinciplesByTier).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ consumerContexts: ["ui"] }),
    );
    expect(scoredWeight("cmd-no-hardcoded-colors")).toBe(1.0);
  });

  it("scores a declared-but-non-matching row at 0 as defense-in-depth (retrieval should already have excluded it)", async () => {
    // Simulates a retrieval path/mock that didn't apply the consumerContexts
    // filter — mirrors how ringScope's post-filter guards the same gap.
    db.listPrinciplesByTier.mockResolvedValue([NO_HARDCODED_COLORS]);

    await invoke({ consumerContexts: ["finance"] });

    expect(scoredWeight("cmd-no-hardcoded-colors")).toBe(0);
  });

  it("fails fast on a malformed consumerContexts shape, before any lookup", async () => {
    const res = await invoke({ consumerContexts: [123] });
    expect(res.success).toBe(false);
    expect(res.error).toBe("Invalid consumerContexts shape");
    expect(db.listPrinciplesByTier).not.toHaveBeenCalled();
  });

  it("omits consumerContexts from the listPrinciplesByTier call when the caller declared none", async () => {
    db.listPrinciplesByTier.mockResolvedValue([]);

    await invoke();

    expect(db.listPrinciplesByTier).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ consumerContexts: undefined }),
    );
  });
});
