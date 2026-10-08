import { describe, expect, it } from "vitest";

import { bottleneckSentence, heroShape, resolveHeroPortfolio } from "./main-stream-hero";

const flows = (loads: Record<string, number>) => Object.entries(loads).map(([key, flowLoad]) => ({ key: key as never, flowLoad }));

describe("resolveHeroPortfolio", () => {
  it("leads with the archetype's primary portfolio", () => {
    expect(resolveHeroPortfolio({ productsAndServicesSold: { scope: "primary" }, foundational: { scope: "minimal" } }, flows({ foundational: 40, productsAndServicesSold: 2 })))
      .toBe("productsAndServicesSold");
  });

  it("between two primary portfolios, the one with more work in flow wins", () => {
    expect(resolveHeroPortfolio(
      { productsAndServicesSold: { scope: "primary" }, manufactureAndDeliver: { scope: "primary" } },
      flows({ productsAndServicesSold: 3, manufactureAndDeliver: 9 }),
    )).toBe("manufactureAndDeliver");
  });

  it("with no declared primary, uses the busiest portfolio", () => {
    expect(resolveHeroPortfolio(null, flows({ forEmployees: 5, foundational: 2 }))).toBe("forEmployees");
  });
});

describe("bottleneckSentence", () => {
  const shape = (shapeKey: string, roomsHeld: number, cause: string) => ({
    shapeKey, shapeRef: `${shapeKey}@1.0.0`, roomsInFlow: roomsHeld + 1, flowTimeP50Ms: null, runs: 0,
    bottleneck: { stageKey: "merge", roomsHeld, cause },
  });

  it("names the step holding the most rooms, in plain words", () => {
    expect(bottleneckSentence({ shapes: [shape("a", 2, "awaiting-person"), shape("b", 5, "conformance_pause")] }, (k) => k.toUpperCase()))
      .toBe("5 rooms are held at merge in B (blocked: conformance pause).");
  });

  it("says nothing when nothing waits", () => {
    expect(bottleneckSentence({ shapes: [] }, (k) => k)).toBeNull();
    expect(heroShape({ shapes: [] })).toBeNull();
  });
});
