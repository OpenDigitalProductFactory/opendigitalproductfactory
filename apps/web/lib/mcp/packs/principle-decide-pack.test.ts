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
vi.mock("@dpf/db/wiki-taxonomy", () => ({
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
