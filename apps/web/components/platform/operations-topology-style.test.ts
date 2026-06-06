import { describe, expect, it } from "vitest";
import {
  markerTypeStroke,
  ROUTE_STATE_LABEL,
  routeStateDash,
  routeStateOpacity,
  routeStateStroke,
  routeVisibleAtReplayTime,
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

  it("scrubs routes with the shared replay playhead", () => {
    const min = (m: number) => m * 60 * 1000;
    const range = { start: 0, current: min(60), end: min(100) }; // window = 45min
    const at = (m: number) => new Date(min(m)).toISOString();

    // Playhead at/after current → active route visible.
    expect(routeVisibleAtReplayTime({ state: "active", occurredAt: at(10) }, range.current, range)).toBe(true);
    // Scrubbed back to t=50: a future active route is hidden, a past one within window is shown.
    expect(routeVisibleAtReplayTime({ state: "active", occurredAt: at(55) }, min(50), range)).toBe(false);
    expect(routeVisibleAtReplayTime({ state: "active", occurredAt: at(48) }, min(50), range)).toBe(true);
    // Scheduled is only visible once the playhead reaches "current".
    expect(routeVisibleAtReplayTime({ state: "scheduled", occurredAt: at(70) }, min(50), range)).toBe(false);
    expect(routeVisibleAtReplayTime({ state: "scheduled", occurredAt: at(70) }, range.current, range)).toBe(true);
    // Undated routes are always visible.
    expect(routeVisibleAtReplayTime({ state: "active", occurredAt: null }, min(50), range)).toBe(true);
  });
});
