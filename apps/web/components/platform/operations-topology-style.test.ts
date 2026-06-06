import { describe, expect, it } from "vitest";
import {
  markerTypeStroke,
  ROUTE_STATE_LABEL,
  routeStateDash,
  routeStateOpacity,
  routeStateStroke,
  routeWidth,
} from "./operations-topology-style";

describe("operations topology style", () => {
  it("maps every route state to a distinct token stroke", () => {
    const strokes = (["active", "secondary", "failover", "scheduled", "historical"] as const).map(routeStateStroke);
    expect(new Set(strokes).size).toBe(5);
    strokes.forEach((s) => expect(s.startsWith("var(--dpf-")).toBe(true));
  });

  it("dashes degraded/scheduled/historical routes and leaves active/secondary solid", () => {
    expect(routeStateDash("active")).toBeUndefined();
    expect(routeStateDash("secondary")).toBeUndefined();
    expect(routeStateDash("failover")).toBe("14 8");
    expect(routeStateDash("scheduled")).toBe("3 9");
    expect(routeStateDash("historical")).toBe("2 7");
  });

  it("fades historical and scheduled routes", () => {
    expect(routeStateOpacity("historical")).toBeLessThan(routeStateOpacity("active"));
    expect(routeStateOpacity("scheduled")).toBeLessThan(routeStateOpacity("active"));
    expect(routeStateOpacity("active")).toBe(0.95);
  });

  it("scales route width with traffic weight and clamps", () => {
    expect(routeWidth(0)).toBeCloseTo(1.25);
    expect(routeWidth(100)).toBe(5);
  });

  it("maps marker types to token strokes and labels every route state", () => {
    expect(markerTypeStroke("error")).toBe("var(--dpf-error)");
    expect(markerTypeStroke("decision")).toBe("var(--dpf-accent)");
    expect(Object.keys(ROUTE_STATE_LABEL)).toHaveLength(5);
  });
});
