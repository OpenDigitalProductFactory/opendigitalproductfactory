// apps/web/components/build/PhaseMiniRail.test.tsx
//
// Pins the accessibility + shape-not-just-color contract for the phase rail.
// The peer reviewer flagged "color-only conveyor" as a critical risk; these
// tests assert role=img on the wrapper, aria-label on each dot, and that
// reached/pending states render distinct CSS class hooks (filled vs outline).

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PhaseMiniRail, PHASE_RAIL_ORDER, derivePhaseDotStates } from "./PhaseMiniRail";
import { BUILD_STUDIO_TEST_IDS } from "./build-studio-layout";

describe("PhaseMiniRail", () => {
  it("wrapper has role='img' and a descriptive aria-label", () => {
    const html = renderToStaticMarkup(<PhaseMiniRail currentPhase="build" />);
    expect(html).toMatch(/role="img"/);
    expect(html).toContain('aria-label="Phases reached: ideate, plan. Active: build."');
  });

  it("falls back to 'No phases reached' for ideate (first phase)", () => {
    const html = renderToStaticMarkup(<PhaseMiniRail currentPhase="ideate" />);
    expect(html).toContain('aria-label="No phases reached. Active: ideate."');
  });

  it("renders one dot per canonical phase", () => {
    const html = renderToStaticMarkup(<PhaseMiniRail currentPhase="build" />);
    for (const phase of PHASE_RAIL_ORDER) {
      // each dot has data-phase=phase
      expect(html).toContain(`data-phase="${phase}"`);
    }
  });

  it("each dot has a discrete aria-label naming its phase and state", () => {
    const html = renderToStaticMarkup(<PhaseMiniRail currentPhase="build" />);
    // ideate + plan are reached; build is active; review + ship are pending
    expect(html).toContain('aria-label="ideate: reached"');
    expect(html).toContain('aria-label="plan: reached"');
    expect(html).toContain('aria-label="build: active"');
    expect(html).toContain('aria-label="review: pending"');
    expect(html).toContain('aria-label="ship: pending"');
  });

  it("uses shape (filled vs outlined) in addition to color — passes WCAG 1.4.1", () => {
    const html = renderToStaticMarkup(<PhaseMiniRail currentPhase="build" />);
    // Reached + active use a filled-shape class hook.
    expect(html).toContain("phase-dot--reached");
    expect(html).toContain("phase-dot--active");
    // Pending uses an outlined-shape class hook (border + transparent bg).
    expect(html).toContain("phase-dot--pending");
    expect(html).toContain("border-[var(--dpf-muted)]");
    expect(html).toContain("bg-transparent");
  });

  it("active dot has a ring AND a fill — distinguishable from plain 'reached' by shape too", () => {
    const html = renderToStaticMarkup(<PhaseMiniRail currentPhase="plan" />);
    // The active dot should include a ring utility class.
    expect(html).toMatch(/data-phase="plan"[^>]+ring-2/);
    // The reached dot (ideate) should NOT include the ring.
    expect(html).not.toMatch(/data-phase="ideate"[^>]+ring-2/);
  });

  it("uses DPF CSS variables for color tokens — no hex literals", () => {
    const html = renderToStaticMarkup(<PhaseMiniRail currentPhase="build" />);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(html).toContain("var(--dpf-accent)");
    expect(html).toContain("var(--dpf-muted)");
  });

  it("emits the canonical test ID on the wrapper", () => {
    const html = renderToStaticMarkup(<PhaseMiniRail currentPhase="ideate" />);
    expect(html).toContain(`data-testid="${BUILD_STUDIO_TEST_IDS.phaseMiniRail}"`);
  });

  it("emits data-current-phase on the wrapper for snapshot diffing", () => {
    const html = renderToStaticMarkup(<PhaseMiniRail currentPhase="review" />);
    expect(html).toContain('data-current-phase="review"');
  });

  it("merges a caller-provided className without losing default classes", () => {
    const html = renderToStaticMarkup(<PhaseMiniRail currentPhase="ship" className="custom-spacing" />);
    expect(html).toContain("custom-spacing");
    expect(html).toContain("inline-flex");
    expect(html).toContain("items-center");
    expect(html).toContain("gap-1");
  });
});

describe("derivePhaseDotStates", () => {
  it("returns the correct state per phase for each position in the canonical order", () => {
    expect(derivePhaseDotStates("ideate")).toEqual(["active", "pending", "pending", "pending", "pending"]);
    expect(derivePhaseDotStates("plan")).toEqual(["reached", "active", "pending", "pending", "pending"]);
    expect(derivePhaseDotStates("build")).toEqual(["reached", "reached", "active", "pending", "pending"]);
    expect(derivePhaseDotStates("review")).toEqual(["reached", "reached", "reached", "active", "pending"]);
    expect(derivePhaseDotStates("ship")).toEqual(["reached", "reached", "reached", "reached", "active"]);
  });

  it("output length matches PHASE_RAIL_ORDER length", () => {
    expect(derivePhaseDotStates("build")).toHaveLength(PHASE_RAIL_ORDER.length);
  });
});
