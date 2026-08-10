// Phase 2 Task 2.7 of the principles-as-wiki-kind plan: principle_decide
// MCP tool tests. Verifies the tool retrieves principles via Postgres +
// Qdrant, runs the decide() math, and returns a complete contribution
// ledger + flags + reasoning.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    organization: {
      findFirst: vi.fn(),
    },
  },
}));

const listPrinciplesByTier = vi.fn();
const searchWikiPages = vi.fn();
const generateEmbedding = vi.fn();
const isEmbeddingAvailable = vi.fn();

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
  listPrinciplesByTier: (...args: unknown[]) => listPrinciplesByTier(...args),
  QDRANT_COLLECTIONS: { WIKI_PAGES: "wiki-pages" },
  PRINCIPLE_DECIDE_DEFAULTS: {
    maxPrinciples: 20,
    tieMargin: 0.2,
    contextualSimilarityThreshold: 0.75,
    semanticFallbackWarnRatio: 0.4,
  },
}));

vi.mock("@/lib/wiki/embeddings", () => ({
  searchWikiPages: (...args: unknown[]) => searchWikiPages(...args),
}));

vi.mock("@/lib/inference/embedding", () => ({
  generateEmbedding: (...args: unknown[]) => generateEmbedding(...args),
  isEmbeddingAvailable: (...args: unknown[]) => isEmbeddingAvailable(...args),
}));

import { executeTool } from "./mcp-tools";

afterEach(() => {
  mockPrisma.organization.findFirst.mockReset();
  listPrinciplesByTier.mockReset();
  searchWikiPages.mockReset();
  generateEmbedding.mockReset();
  isEmbeddingAvailable.mockReset();
});

// Provider healthy by default — these tests predate BI-512FBD20 and assert on
// retrieval + scoring, not on the degradation path. The pack only probes
// isEmbeddingAvailable when BOTH retrieval passes are empty; a default of true
// keeps a genuinely-empty consult classified as "no match", not "provider down".
beforeEach(() => {
  isEmbeddingAvailable.mockResolvedValue(true);
});

// ─── Fixtures ───────────────────────────────────────────────────────────────

function principlePgRow(
  id: string,
  overrides: Partial<{
    title: string;
    principleTier: string;
    principleWeight: number | null;
    principleDimensionVector: Record<string, number> | null;
    principleDirection: string;
    principleAppliesTo: string[];
  }> = {},
) {
  return {
    id,
    slug: `principles/${id}`,
    title: overrides.title ?? id,
    principleTier: overrides.principleTier ?? "commandment",
    principleWeight: overrides.principleWeight ?? null,
    principleDirection: overrides.principleDirection ?? `Direction for ${id}.`,
    principleDimensionVector: overrides.principleDimensionVector ?? null,
    principleAppliesTo:
      overrides.principleAppliesTo ?? ["in_platform_coworker"],
  };
}

function principleQdrantHit(
  id: string,
  tier: "core" | "contextual",
  overrides: Partial<{
    principleDimensions: string[];
    score: number;
    title: string;
    principleWeight: number;
  }> = {},
) {
  return {
    pageId: id,
    slug: `principles/${id}`,
    title: overrides.title ?? id,
    pageKind: "principle",
    contentPreview: `Direction for ${id}.`,
    isKernel: true,
    organizationId: null,
    kernelPageId: null,
    score: overrides.score ?? 0.85,
    source: "kernel" as const,
    principleTier: tier,
    principleAppliesTo: ["in_platform_coworker"],
    principleDimensions: overrides.principleDimensions ?? [
      "schema_grounding",
    ],
    // BI-A9E9ADCB (RC3): a per-principle weight override on the Qdrant payload.
    ...(overrides.principleWeight !== undefined
      ? { principleWeight: overrides.principleWeight }
      : {}),
    principlePublic: false,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("principle_decide MCP tool", () => {
  it("retrieves commandments via Postgres and core/contextual via Qdrant, then returns a recommendation", async () => {
    mockPrisma.organization.findFirst.mockResolvedValueOnce({ id: "org_a" });
    // Commandments from Postgres
    listPrinciplesByTier.mockResolvedValueOnce([
      principlePgRow("arch", {
        title: "Architecture Over Shortcuts",
        principleTier: "commandment",
        principleDimensionVector: { schema_grounding: 1.0 },
      }),
    ]);
    // Two Qdrant calls: core (first) and contextual (second)
    searchWikiPages
      .mockResolvedValueOnce([
        principleQdrantHit("rs", "core", {
          title: "Reusability by Design",
        }),
      ])
      .mockResolvedValueOnce([]);

    const res = await executeTool(
      "principle_decide",
      {
        context: "Should we take the quick patch or refactor?",
        options: [
          { id: "patch", description: "3-line patch", features: { schema_grounding: 0.1 } },
          { id: "refactor", description: "Refactor module", features: { schema_grounding: 0.9 } },
        ],
        callingPopulation: "external_coding_agent",
      },
      "user_test",
    );

    expect(res.success).toBe(true);
    const data = res.data as {
      recommendation: { optionId: string; confidence: string } | null;
      scores: unknown[];
      flags: Record<string, unknown>;
      reasoning: string;
    };
    expect(data.recommendation?.optionId).toBe("refactor");
    expect(data.scores).toHaveLength(2);
    expect(data.reasoning).toContain("refactor");
  });

  // BI-A9E9ADCB (RC3): a core/contextual principle carrying an explicit
  // principleWeight override must be honored (the code path previously passed
  // undefined and silently used the tier default). This exercises that override
  // path end-to-end without error and returns a complete result.
  it("honors a principleWeight override on a core/contextual principle without error", async () => {
    mockPrisma.organization.findFirst.mockResolvedValueOnce({ id: "org_a" });
    listPrinciplesByTier.mockResolvedValueOnce([]);
    searchWikiPages
      .mockResolvedValueOnce([
        principleQdrantHit("rs", "core", { title: "Reusability", principleWeight: 0.9 }),
      ])
      .mockResolvedValueOnce([]);

    const res = await executeTool(
      "principle_decide",
      {
        context: "Should we take the quick patch or refactor?",
        options: [
          { id: "patch", description: "3-line patch", features: { schema_grounding: 0.1 } },
          { id: "refactor", description: "Refactor module", features: { schema_grounding: 0.9 } },
        ],
        callingPopulation: "external_coding_agent",
      },
      "user_test",
    );

    // The override path must run cleanly and produce a complete result. A
    // null recommendation is a legitimate outcome here (no commandments + a
    // single core principle with neutral semantic alignment ⇒ a tie); the point
    // is that hit["principleWeight"] threads through resolveWeight without error.
    expect(res.success).toBe(true);
    const data = res.data as { scores: unknown[] };
    expect(data.scores).toHaveLength(2);
  });

  it("forwards callingPopulation as appliesTo to both Postgres and Qdrant retrieval", async () => {
    mockPrisma.organization.findFirst.mockResolvedValueOnce({ id: "org_a" });
    listPrinciplesByTier.mockResolvedValueOnce([]);
    searchWikiPages.mockResolvedValue([]);

    await executeTool(
      "principle_decide",
      {
        context: "x",
        options: [{ id: "a", description: "A", features: {} }],
        callingPopulation: "human",
      },
      "user_test",
    );

    const pgCallArgs = listPrinciplesByTier.mock.calls[0][1] as {
      appliesTo: string;
      tier: string;
    };
    expect(pgCallArgs.appliesTo).toBe("human");
    expect(pgCallArgs.tier).toBe("commandment");

    for (const call of searchWikiPages.mock.calls) {
      const arg = call[0] as { principleAppliesTo?: string };
      expect(arg.principleAppliesTo).toBe("human");
    }
  });

  it("returns recommendation=null with descriptive reasoning when no principles apply", async () => {
    mockPrisma.organization.findFirst.mockResolvedValueOnce({ id: "org_a" });
    listPrinciplesByTier.mockResolvedValueOnce([]);
    searchWikiPages.mockResolvedValue([]);

    const res = await executeTool(
      "principle_decide",
      {
        context: "x",
        options: [{ id: "a", description: "A", features: {} }],
        callingPopulation: "human",
      },
      "user_test",
    );

    const data = res.data as {
      recommendation: unknown;
      reasoning: string;
    };
    expect(data.recommendation).toBeNull();
    expect(data.reasoning).toMatch(/no .*principles/i);
  });

  it("respects an explicit tieMargin override from the caller", async () => {
    mockPrisma.organization.findFirst.mockResolvedValueOnce({ id: "org_a" });
    listPrinciplesByTier.mockResolvedValueOnce([
      principlePgRow("p", {
        principleDimensionVector: { schema_grounding: 1.0 },
      }),
    ]);
    searchWikiPages.mockResolvedValue([]);

    const res = await executeTool(
      "principle_decide",
      {
        context: "x",
        options: [
          {
            id: "a",
            description: "A",
            features: {
              schema_grounding: 0.5,
              long_term_maintainability: 0.4,
              evidence_density: 0.4,
            },
          },
          {
            id: "b",
            description: "B",
            features: {
              schema_grounding: 0.51,
              long_term_maintainability: 0.4,
              evidence_density: 0.4,
            },
          },
        ],
        callingPopulation: "human",
        tieMargin: 0.001, // very tight → margin 0.01 should clear it
        // Isolate tie-margin from BI-1D23EC26 sensitivity gate for this unit.
        minFeatureKeys: 3,
        sensitivityEpsilon: 0,
      },
      "user_test",
    );

    const data = res.data as {
      recommendation: { confidence: string } | null;
      flags: { tieMargin: number };
    };
    expect(data.recommendation?.confidence).toBe("high");
    expect(data.flags.tieMargin).toBe(0.001);
  });

  it("returns a failure response when options array is missing or empty", async () => {
    const res = await executeTool(
      "principle_decide",
      {
        context: "x",
        options: [],
        callingPopulation: "human",
      },
      "user_test",
    );
    expect(res.success).toBe(false);
    expect(res.error ?? res.message).toMatch(/options/i);
  });

  it("returns a failure response when callingPopulation is not one of the documented values", async () => {
    const res = await executeTool(
      "principle_decide",
      {
        context: "x",
        options: [{ id: "a", description: "A", features: {} }],
        callingPopulation: "not_a_population",
      },
      "user_test",
    );
    expect(res.success).toBe(false);
    expect(res.error ?? res.message).toMatch(/callingPopulation/i);
  });

  it("falls back to semantic alignment using server-side embeddings when option features are empty and principles come from Qdrant (BI-3C1A6451)", async () => {
    mockPrisma.organization.findFirst.mockResolvedValueOnce({ id: "org_a" });
    // No PG commandments — only a Qdrant core hit. The Qdrant payload omits
    // the signed dimension vector, so the principle's dimensionVector is {} →
    // decide() falls back to semantic alignment for every contribution.
    listPrinciplesByTier.mockResolvedValueOnce([]);
    searchWikiPages
      .mockResolvedValueOnce([
        principleQdrantHit("arch", "core", {
          title: "Architecture Over Shortcuts",
        }),
      ])
      .mockResolvedValueOnce([]);

    // Distinct embeddings keyed by input text prefix so the cosine math is
    // observable. Refactor option is aligned with the principle direction
    // (high cosine); patch option is orthogonal (cosine ≈ 0).
    generateEmbedding.mockImplementation(async (text: string) => {
      if (text.includes("Direction for arch")) return [1, 0, 0];
      if (text.includes("Refactor with proper architecture"))
        return [0.95, 0.05, 0];
      if (text.includes("Quick 3-line patch")) return [0, 1, 0];
      return [0, 0, 1];
    });

    const res = await executeTool(
      "principle_decide",
      {
        context: "Should we refactor or patch?",
        options: [
          { id: "patch", description: "Quick 3-line patch", features: {} },
          {
            id: "refactor",
            description: "Refactor with proper architecture",
            features: {},
          },
        ],
        callingPopulation: "human",
      },
      "user_test",
    );

    expect(res.success).toBe(true);
    const data = res.data as {
      recommendation: { optionId: string } | null;
      scores: Array<{
        optionId: string;
        composite: number;
        contributions: Array<{ alignment: number; mode: string }>;
      }>;
    };
    // Every contribution must be semantic mode — the only principle is a Qdrant
    // hit with no dimension vector.
    const allContribs = data.scores.flatMap((s) => s.contributions);
    expect(allContribs.length).toBeGreaterThan(0);
    expect(allContribs.every((c) => c.mode === "semantic")).toBe(true);
    // The pre-fix dead-code path collapsed every alignment to 0. With the fix,
    // at least one contribution must show meaningful semantic similarity.
    expect(allContribs.some((c) => Math.abs(c.alignment) > 0.5)).toBe(true);
    // Refactor option is aligned with the principle direction → wins.
    expect(data.recommendation?.optionId).toBe("refactor");
  });

  it("uses principleWeight override from Postgres when present (otherwise tier default)", async () => {
    mockPrisma.organization.findFirst.mockResolvedValueOnce({ id: "org_a" });
    listPrinciplesByTier.mockResolvedValueOnce([
      principlePgRow("p", {
        principleTier: "commandment",
        principleWeight: 0.25, // override the 1.0 commandment default
        principleDimensionVector: { schema_grounding: 1.0 },
      }),
    ]);
    searchWikiPages.mockResolvedValue([]);

    const res = await executeTool(
      "principle_decide",
      {
        context: "x",
        options: [
          { id: "a", description: "A", features: { schema_grounding: 1.0 } },
        ],
        callingPopulation: "human",
      },
      "user_test",
    );
    const data = res.data as {
      scores: Array<{
        composite: number;
        contributions: Array<{ weight: number }>;
      }>;
    };
    expect(data.scores[0].contributions[0].weight).toBe(0.25);
    expect(data.scores[0].composite).toBe(0.25); // 0.25 × 1.0
  });
});
