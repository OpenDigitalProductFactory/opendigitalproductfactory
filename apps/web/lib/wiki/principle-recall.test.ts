// Phase 2 Task 2.2 of the principles-as-wiki-kind plan:
// recallPrincipleContext orchestrator tests.
//
// Spec: docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md §12.1
// Plan: docs/superpowers/plans/2026-05-12-principles-as-wiki-kind.md (Phase 2 Task 2.2)

import { afterEach, describe, expect, it, vi } from "vitest";

const listPrinciplesByTier = vi.fn();
const searchWikiPages = vi.fn();

vi.mock("@dpf/db", () => ({
  listPrinciplesByTier: (...args: unknown[]) => listPrinciplesByTier(...args),
  prisma: {},
  PRINCIPLE_DECIDE_DEFAULTS: {
    maxPrinciples: 20,
    tieMargin: 0.2,
    contextualSimilarityThreshold: 0.75,
    semanticFallbackWarnRatio: 0.4,
  },
}));

vi.mock("./embeddings", () => ({
  searchWikiPages: (...args: unknown[]) => searchWikiPages(...args),
}));

import { recallPrincipleContext, formatPrincipleContext } from "./principle-recall";

afterEach(() => {
  listPrinciplesByTier.mockReset();
  searchWikiPages.mockReset();
});

// ─── Test fixtures ──────────────────────────────────────────────────────────

function makeCommandmentRow(id: string, title: string, direction: string) {
  return {
    id,
    slug: `principles/${id}`,
    title,
    pageKind: "principle",
    principleTier: "commandment",
    principleDirection: direction,
    principleAppliesTo: ["in_platform_coworker", "external_coding_agent"],
    isKernel: true,
    organizationId: null,
    kernelPageId: null,
  };
}

function makeQdrantHit(
  slug: string,
  title: string,
  tier: string,
  score = 0.8,
) {
  return {
    pageId: slug.replace("/", "_"),
    slug,
    title,
    pageKind: "principle",
    contentPreview: `Direction text for ${title}`,
    isKernel: true,
    organizationId: null,
    kernelPageId: null,
    score,
    source: "kernel" as const,
  };
}

// ─── recallPrincipleContext ─────────────────────────────────────────────────

describe("recallPrincipleContext: commandment branch", () => {
  it("always injects in-scope commandments from Postgres, even when Qdrant is unreachable", async () => {
    listPrinciplesByTier.mockResolvedValueOnce([
      makeCommandmentRow(
        "architecture-over-shortcuts",
        "Architecture Over Shortcuts",
        "Prefer long-term maintainability over short-term speed.",
      ),
      makeCommandmentRow(
        "evidence-before-diagnosis",
        "Evidence Before Diagnosis",
        "Prefer queried state over inferred causes.",
      ),
    ]);
    // Simulate Qdrant down
    searchWikiPages.mockRejectedValue(new Error("Qdrant unreachable"));

    const result = await recallPrincipleContext({
      query: "should I take the quick fix?",
      organizationId: null,
      callingPopulation: "external_coding_agent",
    });

    expect(result).not.toBeNull();
    expect(result?.commandments).toHaveLength(2);
    expect(result?.commandments[0].title).toBe("Architecture Over Shortcuts");
    expect(result?.block).toContain("Architecture Over Shortcuts");
    expect(result?.block).toContain("Evidence Before Diagnosis");
  });

  it("caps commandment retrieval at 10 even if Postgres returns more", async () => {
    const rows = Array.from({ length: 12 }).map((_, i) =>
      makeCommandmentRow(`p${i}`, `P${i}`, `Direction ${i}.`),
    );
    listPrinciplesByTier.mockResolvedValueOnce(rows);
    searchWikiPages.mockResolvedValue([]);

    await recallPrincipleContext({
      query: "x",
      organizationId: null,
      callingPopulation: "in_platform_coworker",
    });

    const firstCallArgs = listPrinciplesByTier.mock.calls[0][1] as {
      tier: string;
      limit: number;
    };
    expect(firstCallArgs.tier).toBe("commandment");
    expect(firstCallArgs.limit).toBe(10);
  });

  it("scopes commandments by callingPopulation via appliesTo", async () => {
    listPrinciplesByTier.mockResolvedValueOnce([]);
    searchWikiPages.mockResolvedValue([]);

    await recallPrincipleContext({
      query: "x",
      organizationId: null,
      callingPopulation: "human",
    });

    const firstCallArgs = listPrinciplesByTier.mock.calls[0][1] as {
      appliesTo: string;
    };
    expect(firstCallArgs.appliesTo).toBe("human");
  });
});

describe("recallPrincipleContext: core branch", () => {
  it("retrieves top relevant core principles via searchWikiPages with tier='core', limit=5", async () => {
    listPrinciplesByTier.mockResolvedValueOnce([]);
    searchWikiPages
      .mockResolvedValueOnce([
        makeQdrantHit("principles/reusability", "Reusability by Design", "core", 0.85),
        makeQdrantHit("principles/specialization", "Specialization", "core", 0.78),
      ])
      .mockResolvedValueOnce([]); // contextual call

    const result = await recallPrincipleContext({
      query: "agent specialization",
      organizationId: null,
      callingPopulation: "in_platform_coworker",
    });

    expect(result?.core).toHaveLength(2);
    // Find the searchWikiPages call that targeted core tier
    const coreCall = searchWikiPages.mock.calls.find((c) => {
      const arg = c[0] as { principleTier?: string };
      return arg.principleTier === "core";
    });
    expect(coreCall).toBeDefined();
    const coreArgs = coreCall![0] as {
      pageKind: string;
      principleTier: string;
      principleAppliesTo: string;
      limit: number;
    };
    expect(coreArgs).toMatchObject({
      pageKind: "principle",
      principleTier: "core",
      principleAppliesTo: "in_platform_coworker",
      limit: 5,
    });
  });

  it("returns empty core array when no Qdrant core matches exist (commandments still surface)", async () => {
    listPrinciplesByTier.mockResolvedValueOnce([
      makeCommandmentRow("a", "Anchor", "Direction A."),
    ]);
    searchWikiPages.mockResolvedValue([]);

    const result = await recallPrincipleContext({
      query: "no matches",
      organizationId: null,
      callingPopulation: "in_platform_coworker",
    });
    expect(result).not.toBeNull();
    expect(result?.core).toEqual([]);
    expect(result?.contextual).toEqual([]);
    expect(result?.commandments).toHaveLength(1);
  });
});

describe("recallPrincipleContext: contextual branch (threshold-gated)", () => {
  it("retrieves contextual principles only above the configured similarity threshold", async () => {
    listPrinciplesByTier.mockResolvedValueOnce([]);
    searchWikiPages
      .mockResolvedValueOnce([]) // core call
      .mockResolvedValueOnce([
        makeQdrantHit("principles/db-fix-seed-migration", "DB fix = seed + migration", "contextual", 0.81),
      ]);

    const result = await recallPrincipleContext({
      query: "database fix",
      organizationId: null,
      callingPopulation: "in_platform_coworker",
    });

    const contextualCall = searchWikiPages.mock.calls.find((c) => {
      const arg = c[0] as { principleTier?: string };
      return arg.principleTier === "contextual";
    });
    expect(contextualCall).toBeDefined();
    const contextualArgs = contextualCall![0] as {
      principleTier: string;
      scoreThreshold: number;
    };
    expect(contextualArgs.principleTier).toBe("contextual");
    expect(contextualArgs.scoreThreshold).toBe(0.75);
    expect(result?.contextual).toHaveLength(1);
  });
});

describe("recallPrincipleContext: silent-degradation", () => {
  it("returns commandments even when both Qdrant calls reject", async () => {
    listPrinciplesByTier.mockResolvedValueOnce([
      makeCommandmentRow("p1", "P1", "Direction 1."),
    ]);
    searchWikiPages.mockRejectedValue(new Error("Qdrant down"));

    const result = await recallPrincipleContext({
      query: "x",
      organizationId: null,
      callingPopulation: "human",
    });

    expect(result?.commandments).toHaveLength(1);
    expect(result?.core).toEqual([]);
    expect(result?.contextual).toEqual([]);
  });

  it("returns null when Postgres rejects AND Qdrant has no matches (nothing to inject)", async () => {
    listPrinciplesByTier.mockRejectedValueOnce(new Error("Postgres down"));
    searchWikiPages.mockResolvedValue([]);

    const result = await recallPrincipleContext({
      query: "x",
      organizationId: null,
      callingPopulation: "human",
    });

    expect(result).toBeNull();
  });

  it("returns null when nothing in scope matches (all three branches empty)", async () => {
    listPrinciplesByTier.mockResolvedValueOnce([]);
    searchWikiPages.mockResolvedValue([]);

    const result = await recallPrincipleContext({
      query: "x",
      organizationId: null,
      callingPopulation: "human",
    });

    expect(result).toBeNull();
  });
});

describe("recallPrincipleContext: org overlay support", () => {
  it("passes organizationId through to both Postgres and Qdrant for overlay-aware retrieval", async () => {
    listPrinciplesByTier.mockResolvedValueOnce([]);
    searchWikiPages.mockResolvedValue([]);

    await recallPrincipleContext({
      query: "x",
      organizationId: "org_acme",
      callingPopulation: "in_platform_coworker",
    });

    const pgArgs = listPrinciplesByTier.mock.calls[0][1] as {
      organizationId: string;
    };
    expect(pgArgs.organizationId).toBe("org_acme");

    for (const call of searchWikiPages.mock.calls) {
      const arg = call[0] as { organizationId: string | null };
      expect(arg.organizationId).toBe("org_acme");
    }
  });
});

// ─── formatPrincipleContext (pure formatter) ────────────────────────────────

describe("formatPrincipleContext", () => {
  it("renders a Governance Principles block with tier sections in order", () => {
    const block = formatPrincipleContext({
      commandments: [
        makeCommandmentRow(
          "architecture",
          "Architecture Over Shortcuts",
          "Prefer maintainability.",
        ),
      ],
      core: [makeQdrantHit("principles/reusability", "Reusability", "core")],
      contextual: [
        makeQdrantHit("principles/db-fix", "DB fix = seed + migration", "contextual"),
      ],
    });

    expect(block).not.toBeNull();
    expect(block).toContain("GOVERNANCE PRINCIPLES");
    expect(block).toContain("Commandments");
    expect(block).toContain("Core");
    expect(block).toContain("Contextual");
    // Section order: Commandments first, then Core, then Contextual
    const cmdIdx = block!.indexOf("Commandments");
    const coreIdx = block!.indexOf("Core");
    const ctxIdx = block!.indexOf("Contextual");
    expect(cmdIdx).toBeLessThan(coreIdx);
    expect(coreIdx).toBeLessThan(ctxIdx);
  });

  it("omits empty tier sections to keep the prompt block compact", () => {
    const block = formatPrincipleContext({
      commandments: [
        makeCommandmentRow("a", "A", "Direction A."),
      ],
      core: [],
      contextual: [],
    });
    expect(block).toContain("Commandments");
    expect(block).not.toContain("Core:");
    expect(block).not.toContain("Contextual:");
  });

  it("returns null when all three tier arrays are empty (caller drops the block)", () => {
    expect(
      formatPrincipleContext({ commandments: [], core: [], contextual: [] }),
    ).toBeNull();
  });

  it("includes the direction text for each commandment so the prompt has the prescriptive sentence", () => {
    const block = formatPrincipleContext({
      commandments: [
        makeCommandmentRow(
          "ev",
          "Evidence Before Diagnosis",
          "Prefer queried state over inferred causes.",
        ),
      ],
      core: [],
      contextual: [],
    });
    expect(block).toContain("Prefer queried state over inferred causes.");
  });
});
