import { describe, expect, it, vi } from "vitest";
import { recommendOptionAgainstCommandments } from "./option-recommendation";

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
