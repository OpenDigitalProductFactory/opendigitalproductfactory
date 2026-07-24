import { describe, expect, it } from "vitest";
import {
  PROFESSION_LOCAL_AXIS_ATTENUATION,
  ROUTE_DOMAIN_CONTEXTLESS_ATTENUATION,
  consumerContextWeightMultiplier,
  professionLocalAttenuationFactor,
  professionLocalShare,
} from "./consumer-context-attenuation";

describe("professionLocalShare", () => {
  it("is 0 for an all-spine vector", () => {
    expect(
      professionLocalShare({ long_term_maintainability: 0.9, blast_radius: -0.3 }),
    ).toBe(0);
  });

  it("is 1 for an all-profession-local vector", () => {
    expect(professionLocalShare({ reusability: 0.5, schema_grounding: 0.5 })).toBe(1);
  });

  it("computes the magnitude-weighted share for a mixed vector (the BI's own example)", () => {
    // no-hardcoded-colors: long_term_maintainability (spine, 0.9),
    // reusability (local, 0.7), schema_grounding (local, 0.5).
    const share = professionLocalShare({
      long_term_maintainability: 0.9,
      reusability: 0.7,
      schema_grounding: 0.5,
    });
    expect(share).toBeCloseTo(1.2 / 2.1, 6);
  });

  it("ignores unknown (non-registry) keys", () => {
    expect(
      professionLocalShare({ long_term_maintainability: 0.9, made_up_axis: 5 }),
    ).toBe(0);
  });

  it("is 0 for an empty vector", () => {
    expect(professionLocalShare({})).toBe(0);
  });

  it("uses magnitude (abs), so a negative cost-axis weight still counts", () => {
    // vendor_lock_in is profession-local (devops-platform) and typically
    // authored negative (a cost axis).
    expect(professionLocalShare({ vendor_lock_in: -0.8 })).toBe(1);
  });
});

describe("professionLocalAttenuationFactor", () => {
  it("is 1 (no attenuation) for a share of 0", () => {
    expect(professionLocalAttenuationFactor({ long_term_maintainability: 0.9 })).toBe(1);
  });

  it("is the floor for a share of 1", () => {
    expect(professionLocalAttenuationFactor({ reusability: 1 })).toBe(
      PROFESSION_LOCAL_AXIS_ATTENUATION,
    );
  });

  it("interpolates linearly between 1 and the floor by share", () => {
    // share = 0.5 → 1 - 0.5*(1-0.5) = 0.75
    const v = { long_term_maintainability: 0.5, reusability: 0.5 };
    expect(professionLocalAttenuationFactor(v)).toBeCloseTo(0.75, 6);
  });
});

describe("consumerContextWeightMultiplier", () => {
  const UI_VECTOR = {
    long_term_maintainability: 0.9,
    reusability: 0.7,
    schema_grounding: 0.5,
  };

  it("is a no-op (1) for any archetype other than route-domain-specific", () => {
    expect(
      consumerContextWeightMultiplier({
        consumerArchetype: "universal",
        principleConsumerContexts: [],
        callerConsumerContexts: undefined,
        dimensionVector: UI_VECTOR,
      }),
    ).toBe(1);
    expect(
      consumerContextWeightMultiplier({
        consumerArchetype: null,
        principleConsumerContexts: null,
        callerConsumerContexts: undefined,
        dimensionVector: UI_VECTOR,
      }),
    ).toBe(1);
  });

  it("is a no-op (1) for a route-domain-specific row with empty own contexts (un-backfilled — backward compat)", () => {
    expect(
      consumerContextWeightMultiplier({
        consumerArchetype: "route-domain-specific",
        principleConsumerContexts: [],
        callerConsumerContexts: undefined,
        dimensionVector: UI_VECTOR,
      }),
    ).toBe(1);
  });

  it("attenuates a route-domain-specific row when the caller declared no context", () => {
    const m = consumerContextWeightMultiplier({
      consumerArchetype: "route-domain-specific",
      principleConsumerContexts: ["ui"],
      callerConsumerContexts: undefined,
      dimensionVector: UI_VECTOR,
    });
    // 0.3 (contextless floor) × (1 - (1.2/2.1)×0.5) ≈ 0.2143.
    expect(m).toBeCloseTo(
      ROUTE_DOMAIN_CONTEXTLESS_ATTENUATION * (1 - (1.2 / 2.1) * 0.5),
      6,
    );
    expect(m).toBeGreaterThan(0);
    expect(m).toBeLessThan(1);
  });

  it("returns full weight (1) when the caller's declared context intersects the row's", () => {
    expect(
      consumerContextWeightMultiplier({
        consumerArchetype: "route-domain-specific",
        principleConsumerContexts: ["ui", "storefront"],
        callerConsumerContexts: ["storefront"],
        dimensionVector: UI_VECTOR,
      }),
    ).toBe(1);
  });

  it("returns 0 when the caller declared a context that does NOT intersect (defense-in-depth)", () => {
    expect(
      consumerContextWeightMultiplier({
        consumerArchetype: "route-domain-specific",
        principleConsumerContexts: ["ui"],
        callerConsumerContexts: ["finance"],
        dimensionVector: UI_VECTOR,
      }),
    ).toBe(0);
  });

  it("treats an all-spine route-domain vector gently (contextless floor only, no local penalty)", () => {
    const m = consumerContextWeightMultiplier({
      consumerArchetype: "route-domain-specific",
      principleConsumerContexts: ["engineering-flow"],
      callerConsumerContexts: undefined,
      dimensionVector: { blast_radius: -0.5 },
    });
    expect(m).toBeCloseTo(ROUTE_DOMAIN_CONTEXTLESS_ATTENUATION, 6);
  });
});
