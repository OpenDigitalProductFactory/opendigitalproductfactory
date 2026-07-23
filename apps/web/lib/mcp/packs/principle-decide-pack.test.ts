import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  listPrinciplesByTier: vi.fn(),
  organizationFindFirst: vi.fn(),
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
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = ["principle_decide"];

beforeEach(() => {
  vi.clearAllMocks();
  db.listPrinciplesByTier.mockResolvedValue([]);
  db.organizationFindFirst.mockResolvedValue({ id: "org-1" });
  wiki.searchWikiPages.mockResolvedValue([]);
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

describe("principle-decide pack — registration", () => {
  it("exposes exactly the principle_decide tool with a handler", () => {
    expect(principleDecidePack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(principleDecidePack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of principleDecidePack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grants mirror agent-grants: read-only decision gate needs registry_read", () => {
    expect(principleDecidePack.grants.principle_decide).toEqual(["registry_read"]);
    expect(isToolAllowedByGrants("principle_decide", ["registry_read"])).toBe(true);
  });
});

describe("principle-decide pack — handler behavior (delegation preserved)", () => {
  it("rejects an invalid callingPopulation before any lookup", async () => {
    const res = await principleDecidePack.handlers.principle_decide(
      { context: "x", options: [{ id: "a", description: "A" }], callingPopulation: "nope" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("Invalid callingPopulation");
    expect(db.listPrinciplesByTier).not.toHaveBeenCalled();
  });

  it("rejects an empty options array", async () => {
    const res = await principleDecidePack.handlers.principle_decide(
      { context: "x", options: [], callingPopulation: "human" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("Empty options");
  });

  it("runs the commandment + principle lookups and returns the decision shape", async () => {
    wiki.decide.mockReturnValue({
      recommendation: { optionId: "a", confidence: "high", composite: 0.812 },
      scores: [{ optionId: "a", composite: 0.812 }],
      flags: [],
      reasoning: "clear winner",
    });

    const res = await principleDecidePack.handlers.principle_decide(
      {
        context: "ship now or wait",
        options: [
          { id: "a", description: "ship now" },
          { id: "b", description: "wait" },
        ],
        callingPopulation: "in_platform_coworker",
      },
      "u1",
      { agentId: "agent-9", routeContext: "build", threadId: "t-1" },
    );

    // The Postgres commandment lookup and Qdrant principle search both ran.
    expect(db.listPrinciplesByTier).toHaveBeenCalledOnce();
    expect(wiki.searchWikiPages).toHaveBeenCalled();
    expect(wiki.decide).toHaveBeenCalledOnce();
    // The consult was written to the ledger and the governing profile resolved.
    expect(decision.resolveDecisionCallerContext).toHaveBeenCalledOnce();
    expect(decision.recordKernelConsultInteraction).toHaveBeenCalledOnce();

    expect(res.success).toBe(true);
    expect(res.message).toContain("Recommends a");
    expect(res.data).toMatchObject({
      recommendation: { optionId: "a" },
      governingProfile: { kind: "platform_kernel", profileId: "prof-1" },
      ledger: { interactionId: "int-1" },
    });
  });

  it("fails fast on an unknown ringScope value", async () => {
    const res = await principleDecidePack.handlers.principle_decide(
      {
        context: "x",
        options: [{ id: "a", description: "A" }],
        callingPopulation: "human",
        ringScope: ["ring-1-coworker", "not-a-ring"],
      },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("Invalid ringScope value");
    expect(db.listPrinciplesByTier).not.toHaveBeenCalled();
  });
});

// ── BI-E0151DB2: signal visibility + feature-key consistency ────────────────
//
// principle_decide ran 165 consults with a 16.7% insufficient-signal rate
// because its `features` parameter was documented as "Optional" with the valid
// key set named only by source-file path, and the cost-axis sign convention
// surfaced nowhere. These tests pin the three fixes plus the unreported fourth
// defect: an unknown feature key was silently never read.

describe("principle-decide pack — feature key validation", () => {
  const base = {
    context: "x",
    callingPopulation: "human" as const,
  };

  it("REJECTS an unknown dimension key before any lookup, like ringScope does", async () => {
    const res = await principleDecidePack.handlers.principle_decide(
      {
        ...base,
        options: [{ id: "a", description: "A", features: { maintainability: 0.9 } }],
      },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("Invalid option features");
    // Never reached retrieval — the same fail-fast posture as ringScope.
    expect(db.listPrinciplesByTier).not.toHaveBeenCalled();
  });

  it("names the offending option and suggests the nearest real dimension", async () => {
    const res = await principleDecidePack.handlers.principle_decide(
      {
        ...base,
        options: [{ id: "opt-two", description: "B", features: { blast_radius_score: 0.4 } }],
      },
      "u1",
    );
    expect(res.message).toContain("opt-two");
    expect(res.message).toContain("blast_radius");
  });

  it("rejects an out-of-range feature value", async () => {
    const res = await principleDecidePack.handlers.principle_decide(
      { ...base, options: [{ id: "a", description: "A", features: { reusability: 4 } }] },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("Invalid option features");
  });

  it("accepts a valid feature map and proceeds to scoring", async () => {
    wiki.decide.mockReturnValue({
      recommendation: { optionId: "a", composite: 1, margin: 0.5, confidence: "high" },
      scores: [],
      flags: { insufficientSignal: false, structuredCoverage: "strong", semanticFallbackRatio: 0 },
      reasoning: "ok",
    });
    const res = await principleDecidePack.handlers.principle_decide(
      {
        ...base,
        options: [{ id: "a", description: "A", features: { blast_radius: 0.2, reusability: 0.8 } }],
      },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(db.listPrinciplesByTier).toHaveBeenCalled();
  });
});

describe("principle-decide pack — abstention is machine-checkable", () => {
  it("marks signalQuality.usable=false and says so in the first clause when signal is insufficient", async () => {
    wiki.decide.mockReturnValue({
      recommendation: null,
      scores: [],
      flags: { insufficientSignal: true, structuredCoverage: "strong", semanticFallbackRatio: 0 },
      reasoning: "Insufficient signal.",
    });
    const res = await principleDecidePack.handlers.principle_decide(
      {
        context: "x",
        callingPopulation: "human",
        options: [{ id: "a", description: "A" }, { id: "b", description: "B" }],
      },
      "u1",
    );
    expect(res.success).toBe(true); // advisory tool stays advisory
    expect(res.message).toMatch(/^NO RECOMMENDATION/);
    expect(res.data).toMatchObject({
      recommendation: null,
      signalQuality: { usable: false, insufficientSignal: true, optionsWithFeatures: 0, optionCount: 2 },
    });
  });

  it("tells a caller who supplied NO features exactly why the score was zero", async () => {
    wiki.decide.mockReturnValue({
      recommendation: null,
      scores: [],
      flags: { insufficientSignal: true, structuredCoverage: "strong", semanticFallbackRatio: 0 },
      reasoning: "Insufficient signal.",
    });
    const res = await principleDecidePack.handlers.principle_decide(
      { context: "x", callingPopulation: "human", options: [{ id: "a", description: "A" }] },
      "u1",
    );
    const advisory = (res.data as { signalQuality: { advisory: string } }).signalQuality.advisory;
    expect(advisory).toMatch(/NO OPTION SUPPLIED/);
    expect(advisory).toMatch(/not a neutral or tie result/);
  });

  it("marks usable=true and leaves no advisory on a healthy recommendation", async () => {
    wiki.decide.mockReturnValue({
      recommendation: { optionId: "a", composite: 2, margin: 1, confidence: "high" },
      scores: [],
      flags: { insufficientSignal: false, structuredCoverage: "strong", semanticFallbackRatio: 0 },
      reasoning: "ok",
    });
    const res = await principleDecidePack.handlers.principle_decide(
      {
        context: "x",
        callingPopulation: "human",
        options: [{ id: "a", description: "A", features: { reusability: 0.9 } }],
      },
      "u1",
    );
    expect(res.message).toMatch(/^Recommends a/);
    expect(res.data).toMatchObject({ signalQuality: { usable: true, advisory: null, optionsWithFeatures: 1 } });
  });

  it("persists signal quality to the ledger so the abstention rate is queryable", async () => {
    wiki.decide.mockReturnValue({
      recommendation: null,
      scores: [],
      flags: { insufficientSignal: true, structuredCoverage: "strong", semanticFallbackRatio: 0 },
      reasoning: "Insufficient signal.",
    });
    await principleDecidePack.handlers.principle_decide(
      { context: "x", callingPopulation: "human", options: [{ id: "a", description: "A" }] },
      "u1",
    );
    expect(decision.recordKernelConsultInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        signalQuality: { usable: false, optionsWithFeatures: 0, optionCount: 1 },
      }),
    );
  });
});

describe("principle-decide pack — retrieval degradation is loud (BI-512FBD20)", () => {
  // The failure this pins: on 2026-07-22 the embedding provider was 404ing, so
  // both semantic-retrieval passes came back empty and the consult ran on
  // commandments alone — while reporting structuredCoverage "strong". A consult
  // must never again imply full coverage when core/contextual retrieval was
  // structurally impossible.

  it("flags retrievalDegraded and refuses to be usable when the provider is down", async () => {
    // Both passes empty (searchWikiPages default) AND the provider is down.
    wiki.isEmbeddingAvailable.mockResolvedValue(false);
    wiki.decide.mockReturnValue({
      // Even if the commandment-only field produced a nominal winner, a
      // degraded consult is not a verdict.
      recommendation: { optionId: "a", composite: 2, margin: 1, confidence: "high" },
      scores: [],
      flags: { insufficientSignal: false, structuredCoverage: "strong", semanticFallbackRatio: 0 },
      reasoning: "commandment-only winner",
    });
    const res = await principleDecidePack.handlers.principle_decide(
      {
        context: "x",
        callingPopulation: "human",
        options: [{ id: "a", description: "A", features: { reusability: 0.9 } }],
      },
      "u1",
    );
    expect(res.success).toBe(true); // advisory tool stays advisory
    expect(res.message).toMatch(/^NO RECOMMENDATION — signalQuality\.retrievalDegraded=true/);
    const sq = (res.data as { signalQuality: { usable: boolean; retrievalDegraded: boolean; advisory: string } })
      .signalQuality;
    expect(sq.retrievalDegraded).toBe(true);
    expect(sq.usable).toBe(false);
    expect(sq.advisory).toMatch(/EMBEDDING PROVIDER UNAVAILABLE/);
    expect(sq.advisory).toMatch(/docker model pull ai\/nomic-embed-text-v1\.5/);
  });

  it("does NOT flag degradation when both passes are empty but the provider is up (a genuine no-match)", async () => {
    wiki.isEmbeddingAvailable.mockResolvedValue(true);
    wiki.decide.mockReturnValue({
      recommendation: { optionId: "a", composite: 2, margin: 1, confidence: "high" },
      scores: [],
      flags: { insufficientSignal: false, structuredCoverage: "strong", semanticFallbackRatio: 0 },
      reasoning: "ok",
    });
    const res = await principleDecidePack.handlers.principle_decide(
      {
        context: "x",
        callingPopulation: "human",
        options: [{ id: "a", description: "A", features: { reusability: 0.9 } }],
      },
      "u1",
    );
    expect(res.message).toMatch(/^Recommends a/);
    const sq = (res.data as { signalQuality: { usable: boolean; retrievalDegraded: boolean } }).signalQuality;
    expect(sq.retrievalDegraded).toBe(false);
    expect(sq.usable).toBe(true);
  });

  it("does NOT probe the provider when retrieval actually returned principles", async () => {
    // A populated core pass means retrieval ran — no reason to probe, and no
    // degradation regardless of provider state.
    wiki.searchWikiPages.mockResolvedValueOnce([
      { pageId: "p1", title: "Some Core Principle", principleTier: "core", contentPreview: "direction" },
    ]);
    wiki.decide.mockReturnValue({
      recommendation: { optionId: "a", composite: 2, margin: 1, confidence: "high" },
      scores: [],
      flags: { insufficientSignal: false, structuredCoverage: "strong", semanticFallbackRatio: 0 },
      reasoning: "ok",
    });
    const res = await principleDecidePack.handlers.principle_decide(
      {
        context: "x",
        callingPopulation: "human",
        options: [{ id: "a", description: "A", features: { reusability: 0.9 } }],
      },
      "u1",
    );
    expect(wiki.isEmbeddingAvailable).not.toHaveBeenCalled();
    const sq = (res.data as { signalQuality: { retrievalDegraded: boolean } }).signalQuality;
    expect(sq.retrievalDegraded).toBe(false);
  });
});

describe("principle-decide pack — the dimension registry travels with the schema", () => {
  const featuresSchema = (
    principleDecidePack.definitions[0].inputSchema as {
      properties: { options: { items: { properties: { features: Record<string, unknown> } } } };
    }
  ).properties.options.items.properties.features;

  it("constrains feature keys machine-readably, so a coworker needs no repo access", () => {
    const names = featuresSchema.propertyNames as { enum: string[] };
    expect(names.enum).toEqual(expect.arrayContaining(["blast_radius", "reusability", "data_privacy"]));
    expect(names.enum.length).toBeGreaterThanOrEqual(18);
  });

  it("bounds values to 0..1 in the schema itself", () => {
    expect(featuresSchema.additionalProperties).toMatchObject({ type: "number", minimum: 0, maximum: 1 });
  });

  it("no longer points at a source file the caller cannot read", () => {
    expect(featuresSchema.description as string).not.toContain("packages/db");
  });

  it("states that omitting features is not a neutral result", () => {
    expect(featuresSchema.description as string).toMatch(/REQUIRED IN PRACTICE/);
  });

  it("surfaces the cost-axis sign convention at call time", () => {
    const text = featuresSchema.description as string;
    expect(text).toMatch(/HIGHER IS WORSE/);
    expect(text).toContain("blast_radius");
  });
});
