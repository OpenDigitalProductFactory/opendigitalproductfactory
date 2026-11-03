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
  const shape = (shapeKey: string, roomsHeld: number, cause: string, stageKey = "merge") => ({
    shapeKey, shapeRef: `${shapeKey}@1.0.0`, roomsInFlow: roomsHeld + 1, flowTimeP50Ms: null, runs: 0,
    bottleneck: { stageKey, roomsHeld, cause },
    held: [{ stageKey, roomsHeld, cause }],
  });
  const H = 3_600_000;

  it("names the step holding the most rooms, in plain words", () => {
    expect(bottleneckSentence({ shapes: [shape("a", 2, "awaiting-person"), shape("b", 5, "conformance_pause")] }, (k) => k.toUpperCase()))
      .toBe("5 rooms are held at merge in B (blocked: conformance pause).");
  });

  it("ranks by rooms held × typical wait, so a smaller pile that waits far longer wins", () => {
    const waits: Record<string, number> = { "a@1.0.0:review": 48 * H, "b@1.0.0:merge": 2 * H };
    expect(bottleneckSentence(
      { shapes: [shape("a", 2, "awaiting-person", "review"), shape("b", 5, "conformance_pause")] },
      (k) => k.toUpperCase(),
      (shapeRef, stageKey) => waits[`${shapeRef}:${stageKey}`] ?? null,
    )).toBe("2 rooms are held at review in A, typically waiting 2d (waiting on a person).");
  });

  it("never ranks an unmeasured step on a guessed wait while another held step is measured", () => {
    expect(bottleneckSentence(
      { shapes: [shape("a", 40, "awaiting-person", "review"), shape("b", 1, "conformance_pause")] },
      (k) => k,
      (shapeRef) => (shapeRef === "b@1.0.0" ? H : null),
    )).toMatch(/^1 room is held at merge in b, typically waiting 1h/);
  });

  it("draws the busiest shape the archetype binds to its delivery stage, else the busiest shape", () => {
    const flow = { shapes: [shape("payables-watch", 9, "awaiting-person"), shape("delivery-small", 3, "awaiting-person")] };
    expect(heroShape(flow, new Set(["delivery-small@1.0.0"]))?.shapeKey).toBe("delivery-small");
    expect(heroShape(flow, new Set(["delivery-large@1.0.0"]))?.shapeKey).toBe("payables-watch");
    expect(heroShape(flow)?.shapeKey).toBe("payables-watch");
  });

  it("says nothing when nothing waits", () => {
    expect(bottleneckSentence({ shapes: [] }, (k) => k)).toBeNull();
    expect(heroShape({ shapes: [] })).toBeNull();
  });
});
