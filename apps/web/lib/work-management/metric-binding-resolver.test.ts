import { describe, expect, it } from "vitest";

import {
  resolvableMetricBindingKeys,
  resolveMetricBinding,
  resolveMetricBindings,
  type MetricBindingContext,
} from "./metric-binding-resolver";

const FIXED_NOW = new Date("2026-08-28T12:00:00.000Z");

function context(overrides: Partial<MetricBindingContext> = {}): MetricBindingContext {
  return {
    orgId: "org-1",
    storefrontId: "sf-1",
    countAnimalsByStatus: async () => 0,
    now: () => FIXED_NOW,
    ...overrides,
  };
}

describe("metric binding resolution contract", () => {
  it("resolves a known binding with a value and the time it was computed", async () => {
    const result = await resolveMetricBinding(
      "animals-adoption-ready",
      context({ countAnimalsByStatus: async () => 3 }),
    );

    expect(result).toEqual({
      status: "resolved",
      bindingKey: "animals-adoption-ready",
      value: 3,
      unit: "count",
      computedAt: "2026-08-28T12:00:00.000Z",
    });
  });

  it("reports unmeasurable, not zero, for a binding nothing records", async () => {
    // kennel-occupancy is declared by the archetype but has no writer.
    const result = await resolveMetricBinding("kennel-occupancy", context());

    expect(result.status).toBe("unmeasurable");
    expect(result).not.toHaveProperty("value");
    if (result.status === "unmeasurable") {
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it("distinguishes a true zero from an unmeasurable binding", async () => {
    // This is the whole point: "none right now" and "nothing records this"
    // must not render identically.
    const trueZero = await resolveMetricBinding(
      "completed-adoptions",
      context({ countAnimalsByStatus: async () => 0 }),
    );
    const noWriter = await resolveMetricBinding("medication-adherence", context());

    expect(trueZero).toMatchObject({ status: "resolved", value: 0 });
    expect(noWriter.status).toBe("unmeasurable");
  });

  it("reports unmeasurable when a prerequisite is missing", async () => {
    const result = await resolveMetricBinding(
      "animals-adoption-ready",
      context({ storefrontId: null }),
    );

    expect(result.status).toBe("unmeasurable");
    if (result.status === "unmeasurable") {
      expect(result.reason).toContain("storefront");
    }
  });

  it("reports unmeasurable rather than zero when the read fails", async () => {
    const result = await resolveMetricBinding(
      "approved-matches",
      context({
        countAnimalsByStatus: async () => {
          throw new Error("connection lost");
        },
      }),
    );

    expect(result.status).toBe("unmeasurable");
    expect(result).not.toHaveProperty("value");
  });

  it("never yields a resolved binding without a computed-at timestamp", async () => {
    const results = await resolveMetricBindings(
      [...resolvableMetricBindingKeys(), "kennel-occupancy", "unknown-key"],
      context({ countAnimalsByStatus: async () => 2 }),
    );

    for (const result of results) {
      if (result.status === "resolved") {
        expect(result.computedAt).toBe("2026-08-28T12:00:00.000Z");
        expect(Number.isFinite(result.value)).toBe(true);
      } else {
        expect(result.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it("preserves input order when resolving many", async () => {
    const keys = ["kennel-occupancy", "animals-adoption-ready", "unknown-key"];
    const results = await resolveMetricBindings(keys, context());
    expect(results.map((r) => r.bindingKey)).toEqual(keys);
  });

  it("registers resolvers only for load-bearing bindings with a real writer", async () => {
    // AdoptableAnimal.status is written by the adoption flow; these three read it.
    expect(resolvableMetricBindingKeys()).toEqual([
      "animals-adoption-ready",
      "approved-matches",
      "completed-adoptions",
    ]);
  });
});
