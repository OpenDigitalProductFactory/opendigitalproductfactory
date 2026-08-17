import { describe, expect, it, vi } from "vitest";
import { recommendOptionAgainstCommandments, resolveRecommendedOptionId } from "./option-recommendation";
import type { DecisionScoredOption } from "./types";

// BI-D88DFEEA Phase 1. This module is deliberately commandments-only (see its
// header) — these tests pin that it reuses listPrinciplesByTier + decide()
// without inventing new scoring math, degrades to null on any failure rather
// than throwing, and picks the option decide() actually favors.

function fakeCommandment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "cmd-1",
    title: "Architecture Over Shortcuts",
    principleTier: "commandment",
    principleWeight: null,
    principleDimensionVector: { long_term_maintainability: 0.8, speed_to_value: -0.3 },
    ...overrides,
  };
}

describe("recommendOptionAgainstCommandments", () => {
  it("returns null when no scored options are supplied", async () => {
    const db = { wikiPage: { findMany: vi.fn() } };
    const result = await recommendOptionAgainstCommandments({ db, scoredOptions: [] });
    expect(result).toBeNull();
    expect(db.wikiPage.findMany).not.toHaveBeenCalled();
  });

  it("returns null when the commandment lookup throws, never propagating the error", async () => {
    const db = { wikiPage: { findMany: vi.fn().mockRejectedValue(new Error("db down")) } };
    const result = await recommendOptionAgainstCommandments({
      db,
      scoredOptions: [
        { id: "a", description: "Option A", features: { long_term_maintainability: 0.9 } },
      ],
    });
    expect(result).toBeNull();
  });

  it("returns null when no commandments are returned (insufficient signal)", async () => {
    const db = { wikiPage: { findMany: vi.fn().mockResolvedValue([]) } };
    const result = await recommendOptionAgainstCommandments({
      db,
      scoredOptions: [
        { id: "a", description: "Option A", features: { long_term_maintainability: 0.9 } },
      ],
    });
    expect(result).toBeNull();
  });

  it("picks the option decide() favors given real commandment vectors", async () => {
    const db = {
      wikiPage: {
        findMany: vi.fn().mockResolvedValue([fakeCommandment()]),
      },
    };
    const result = await recommendOptionAgainstCommandments({
      db,
      scoredOptions: [
        {
          id: "revise",
          description: "Revise the plan",
          features: { long_term_maintainability: 0.9, speed_to_value: 0.2 },
        },
        {
          id: "proceed",
          description: "Proceed now",
          features: { long_term_maintainability: 0.2, speed_to_value: 0.9 },
        },
      ],
    });
    // "revise" scores higher on long_term_maintainability (weighted positive)
    // and lower on speed_to_value (weighted negative) — the commandment
    // should favor it.
    expect(result).toBe("revise");
  });

  it("falls back to the tier default weight (1.0) when principleWeight is not a number", async () => {
    const db = {
      wikiPage: {
        findMany: vi.fn().mockResolvedValue([fakeCommandment({ principleWeight: undefined })]),
      },
    };
    const result = await recommendOptionAgainstCommandments({
      db,
      scoredOptions: [
        { id: "a", description: "A", features: { long_term_maintainability: 1 } },
        { id: "b", description: "B", features: { long_term_maintainability: 0 } },
      ],
    });
    expect(result).toBe("a");
  });
});

describe("resolveRecommendedOptionId (BI-6DCF772F guard)", () => {
  const scoredOptions = [
    { id: "revise", description: "Revise the plan", features: { long_term_maintainability: 0.9, speed_to_value: 0.2 } },
    { id: "proceed", description: "Proceed now", features: { long_term_maintainability: 0.2, speed_to_value: 0.9 } },
  ];
  const commandmentDb = () => ({ wikiPage: { findMany: vi.fn().mockResolvedValue([fakeCommandment()]) } });

  it("returns null for an escalate/defer verdict even when scored options are present — never invents a recommendation the kernel declined", async () => {
    const db = commandmentDb();
    for (const outcomeType of ["escalate", "defer"]) {
      expect(await resolveRecommendedOptionId({ db, scoredOptions, outcomeType })).toBeNull();
    }
    expect(db.wikiPage.findMany).not.toHaveBeenCalled();
  });

  it("returns null when no scored options are supplied, regardless of verdict", async () => {
    const db = commandmentDb();
    expect(await resolveRecommendedOptionId({ db, scoredOptions: undefined, outcomeType: "recommend" })).toBeNull();
    expect(await resolveRecommendedOptionId({ db, scoredOptions: [], outcomeType: "recommend" })).toBeNull();
    expect(db.wikiPage.findMany).not.toHaveBeenCalled();
  });

  it("delegates to the commandment argmax for recommend/arbitrate verdicts", async () => {
    for (const outcomeType of ["recommend", "arbitrate"]) {
      const result = await resolveRecommendedOptionId({ db: commandmentDb(), scoredOptions, outcomeType });
      expect(result).toBe("revise");
    }
  });
});

describe("profession-local axis projection (Phase 3, BI-106C2585 / W16)", () => {
  // A commandment that rewards speed and PENALIZES cognitive load. The
  // ux-design local axes (the registry's first real entries) all roll onto
  // human_cognitive_load, so a namespaced clutter score only bites once the
  // projection runs.
  const cognitiveLoadCommandment = {
    id: "cmd-load",
    title: "Human Attention Is A Budget",
    principleTier: "commandment",
    principleWeight: null,
    principleDimensionVector: { speed_to_value: 0.4, human_cognitive_load: -1.0 },
  };
  const scoredOptions: DecisionScoredOption[] = [
    {
      id: "cluttered",
      description: "Ship the dense variant now",
      // Namespaced local axis: ignored without projection (principle vectors
      // are spine-only), decisive with it.
      features: { speed_to_value: 0.9, "ux-design/perceptual_clutter": 0.9 },
    },
    {
      id: "calm",
      description: "Ship the calmer variant",
      features: { speed_to_value: 0.6 },
    },
  ];
  const db = () => ({ wikiPage: { findMany: vi.fn().mockResolvedValue([cognitiveLoadCommandment]) } });

  it("without a professionKey the namespaced feature is inert and the cluttered option wins", async () => {
    const result = await recommendOptionAgainstCommandments({ db: db(), scoredOptions });
    expect(result).toBe("cluttered");
  });

  it("with the owning professionKey the local axis projects onto the spine and moves the recommendation", async () => {
    const result = await recommendOptionAgainstCommandments({
      db: db(),
      scoredOptions,
      professionKey: "ux-design",
    });
    expect(result).toBe("calm");
  });

  it("threads professionKey through resolveRecommendedOptionId (the profession-gate path)", async () => {
    const without = await resolveRecommendedOptionId({
      db: db(),
      scoredOptions,
      outcomeType: "recommend",
    });
    const withProfession = await resolveRecommendedOptionId({
      db: db(),
      scoredOptions,
      outcomeType: "recommend",
      professionKey: "ux-design",
    });
    expect(without).toBe("cluttered");
    expect(withProfession).toBe("calm");
  });

  it("a foreign profession's key drops the unknown namespaced axis instead of inventing one", async () => {
    // data-architect owns no ux-design/* axis, so projection drops the key —
    // same outcome as no projection at all for THIS feature set.
    const result = await recommendOptionAgainstCommandments({
      db: db(),
      scoredOptions,
      professionKey: "data-architect",
    });
    expect(result).toBe("cluttered");
  });
});
