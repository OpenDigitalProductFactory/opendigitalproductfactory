// Option identity is enforced, not merely declared — BI-9889566B.
//
// Split out of principle-decide-pack.test.ts to keep both files under the
// module-size ceiling. The mock scaffolding is the same shape as its sibling:
// the pack lazy-imports Postgres, Qdrant and the embedding provider, so every
// one of them is stubbed and the handler runs its real validation path.
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
    organization: {
      findFirst: (...a: unknown[]) => db.organizationFindFirst(...a),
    },
    // RC2 (BI-E1267C6D): core/contextual principles are relevance-ranked by
    // Qdrant and then rehydrated from Postgres for their signed vector and
    // weight override. Without this the rehydration throws into its own
    // catch and every test silently exercises the pre-fix path.
    wikiPage: {
      findMany: (...a: unknown[]) => db.wikiPageFindMany(...a),
    },
  },
  listPrinciplesByTier: (...a: unknown[]) => db.listPrinciplesByTier(...a),
  PRINCIPLE_DECIDE_DEFAULTS: {
    maxPrinciples: 20,
    tieMargin: 0.2,
    contextualSimilarityThreshold: 0.5,
    semanticFallbackWarnRatio: 0.5,
  },
}));
// Spread the ACTUAL taxonomy rather than hand-listing it: the pack now imports
// PRINCIPLE_DIMENSIONS / PRINCIPLE_COST_DIMENSIONS (via the dimension catalogue,
// BI-E0151DB2), and a hand-maintained fake registry here would drift from the
// real one — reintroducing the class of defect the catalogue exists to prevent.
// The ring scopes stay pinned because these tests assert on them directly.
vi.mock("@dpf/db/wiki-taxonomy", async (importActual) => ({
  ...(await importActual<typeof import("@dpf/db/wiki-taxonomy")>()),
  PRINCIPLE_RING_SCOPES: [
    "ring-1-coworker",
    "ring-2-workflow",
    "ring-3-archetype",
    "ring-4-sandbox-prod",
    "ring-5-hive",
    "external-coordination",
    "universal-ring",
  ],
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
  // Provider healthy by default; the degradation tests flip this to false.
  wiki.isEmbeddingAvailable.mockResolvedValue(true);
  wiki.principleMatchesRingScope.mockReturnValue(true);
  decision.resolveDecisionCallerContext.mockResolvedValue({
    governingProfileId: "prof-1",
    governingProfileKind: "platform_kernel",
    resolvedVia: "default",
  });
  decision.recordKernelConsultInteraction.mockResolvedValue({ interactionId: "int-1" });
});

describe("principle-decide pack — option identity validation (BI-9889566B)", () => {
  const base = { context: "x", callingPopulation: "human" as const };

  it("REFUSES an option whose identity arrived under the wrong key, before any lookup", async () => {
    const res = await principleDecidePack.handlers.principle_decide(
      {
        ...base,
        options: [
          { key: "a", description: "A", features: { reusability: 0.9 } },
          { key: "b", description: "B", features: { reusability: 0.1 } },
        ],
      },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("Invalid option identity");
    // Same fail-fast posture as ringScope and unknown feature keys.
    expect(db.listPrinciplesByTier).not.toHaveBeenCalled();
    // It must NOT score: an id-less set used to come back with identical
    // composites, an empty recommendation.optionId and signalQuality.usable
    // true — a verdict that looked governed and carried no information.
    expect(wiki.decide).not.toHaveBeenCalled();
  });

  it("names the offending keys so the caller can see the typo", async () => {
    const res = await principleDecidePack.handlers.principle_decide(
      { ...base, options: [{ key: "a", description: "A" }] },
      "u1",
    );
    expect(res.message).toContain("key");
    expect(res.message).toContain("`id`");
  });

  it("REFUSES duplicate ids — they collapse exactly like blank ones", async () => {
    const res = await principleDecidePack.handlers.principle_decide(
      {
        ...base,
        options: [
          { id: "same", description: "A", features: { reusability: 0.9 } },
          { id: "same", description: "B", features: { reusability: 0.1 } },
        ],
      },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("Invalid option identity");
  });

  it("REFUSES a missing description", async () => {
    const res = await principleDecidePack.handlers.principle_decide(
      { ...base, options: [{ id: "a" }] },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("Invalid option identity");
  });

  it("identity is reported before features — an id-less option cannot be named in a feature error", async () => {
    const res = await principleDecidePack.handlers.principle_decide(
      { ...base, options: [{ key: "a", description: "A", features: { maintainability: 0.9 } }] },
      "u1",
    );
    expect(res.error).toBe("Invalid option identity");
  });

  it("a well-formed set still reaches scoring, and each option keeps its own features", async () => {
    const scored: Array<{ id: string; features: Record<string, number> }> = [];
    wiki.decide.mockImplementation((options: Array<{ id: string; features: Record<string, number> }>) => {
      scored.push(...options.map((o) => ({ id: o.id, features: o.features })));
      return {
        recommendation: { optionId: "a", composite: 1, margin: 0.5, confidence: "high" },
        scores: [],
        flags: { insufficientSignal: false, structuredCoverage: "strong", semanticFallbackRatio: 0 },
        reasoning: "ok",
      };
    });
    const res = await principleDecidePack.handlers.principle_decide(
      {
        ...base,
        options: [
          { id: "a", description: "A", features: { reusability: 0.9 } },
          { id: "b", description: "B", features: { reusability: 0.1 } },
        ],
      },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(scored).toEqual([
      { id: "a", features: { reusability: 0.9 } },
      { id: "b", features: { reusability: 0.1 } },
    ]);
  });
});
