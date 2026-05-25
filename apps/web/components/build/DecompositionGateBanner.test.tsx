// @vitest-environment jsdom
//
// Coverage for the Phase 3 decomposition gate banner.
// Spec: docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md (§4.1)
// BI: BI-2E6CC391

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DecompositionGateBanner } from "./DecompositionGateBanner";
import type { SizeAssessmentSnapshot } from "@/lib/explore/feature-build-types";

// The web test runner has no global setup file, so each component test
// must clean up its own DOM after every case or React Testing Library
// queries will see leftover renders from prior tests.
afterEach(() => {
  cleanup();
});

function makeAssessment(
  overrides: Partial<SizeAssessmentSnapshot> = {},
): SizeAssessmentSnapshot {
  return {
    decision: "ok",
    breakdown: {
      models: { count: 0, samples: [] },
      endpoints: { count: 0, samples: [] },
      acs: { count: 0 },
      multipliers: { count: 0, matchedKeywords: [] },
      routes: { count: 0, samples: [] },
    },
    trips: [],
    rationale: "Design fits one Plan.",
    thresholds: {
      models: { recommend: 3, required: 5 },
      endpoints: { recommend: 4, required: 7 },
      acs: { recommend: 12, required: 20 },
      multipliers: { recommend: 2, required: 4 },
      routes: { recommend: 2, required: 4 },
    },
    assessedAt: "2026-05-24T20:00:00.000Z",
    ...overrides,
  };
}

describe("DecompositionGateBanner — self-gating", () => {
  it("renders nothing when assessment is null", () => {
    const { container } = render(<DecompositionGateBanner assessment={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when assessment is undefined", () => {
    const { container } = render(<DecompositionGateBanner assessment={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when decision is ok", () => {
    const { container } = render(
      <DecompositionGateBanner assessment={makeAssessment({ decision: "ok" })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("DecompositionGateBanner — decompose-recommended (soft tone)", () => {
  const assessment = makeAssessment({
    decision: "decompose-recommended",
    breakdown: {
      models: { count: 3, samples: ["ModelA", "ModelB", "ModelC"] },
      endpoints: { count: 1, samples: ["GET /api/x"] },
      acs: { count: 8 },
      multipliers: { count: 1, matchedKeywords: ["idempotency"] },
      routes: { count: 1, samples: ["/x"] },
    },
    trips: [{ dimension: "models", level: "recommend", threshold: 3, observed: 3 }],
    rationale: "Design is large. Observed: 3 models, 1 endpoints, 8 ACs, 1 ACs with complexity multipliers, 1 routes. Recommend-threshold trips: models=3>=3. Consider decomposing into 2-3 smaller builds for faster Plan convergence; not blocking.",
  });

  it("renders the banner with the 'recommended' tone", () => {
    render(<DecompositionGateBanner assessment={assessment} />);
    const banner = screen.getByTestId("decomposition-gate-banner");
    expect(banner).toHaveAttribute("data-tone", "recommended");
    expect(screen.getByText(/Decomposition recommended/i)).toBeInTheDocument();
  });

  it("uses softer 'worth considering' headline copy", () => {
    render(<DecompositionGateBanner assessment={assessment} />);
    expect(screen.getByText(/Worth considering/i)).toBeInTheDocument();
    expect(screen.queryByText(/bigger than fits in one build/i)).not.toBeInTheDocument();
  });

  it("renders the observed breakdown", () => {
    render(<DecompositionGateBanner assessment={assessment} />);
    // Breakdown items render the count + label in the same <li>; the
    // rationale paragraph also mentions some labels (e.g. "complexity
    // multipliers"). Assert against the banner's full textContent which
    // unambiguously identifies the count-label pairing.
    const banner = screen.getByTestId("decomposition-gate-banner");
    expect(banner.textContent).toMatch(/3 DB models/);
    expect(banner.textContent).toMatch(/8 acceptance criteria/);
    expect(banner.textContent).toMatch(/1 ACs with complexity multipliers/);
  });

  it("renders the threshold trip evidence", () => {
    render(<DecompositionGateBanner assessment={assessment} />);
    // Exact match on the label string — avoids matching the rationale's
    // "REQUIRED-threshold trips:" substring (case-insensitive collides).
    expect(screen.getByText("Threshold trips")).toBeInTheDocument();
  });

  it("renders the deterministic rationale verbatim", () => {
    render(<DecompositionGateBanner assessment={assessment} />);
    expect(screen.getByText(/Design is large\. Observed/)).toBeInTheDocument();
  });

  it("renders the 'next phase' notice (Phase 3 is informational only)", () => {
    render(<DecompositionGateBanner assessment={assessment} />);
    expect(
      screen.getByText(/decomposition assistant.*ships in the next phase/i),
    ).toBeInTheDocument();
  });
});

describe("DecompositionGateBanner — decompose-required (strong tone)", () => {
  // Mirrors the Dale truck-parts result from spec §1.1.
  const daleAssessment = makeAssessment({
    decision: "decompose-required",
    breakdown: {
      models: {
        count: 5,
        samples: [
          "InventoryItem",
          "InventoryTransaction",
          "LocationInventory",
          "MobileInventoryLocation",
          "MobileInventoryLocationType",
        ],
      },
      endpoints: { count: 2, samples: ["POST /api/inventory/usage", "GET /api/my-inventory"] },
      acs: { count: 25 },
      multipliers: {
        count: 4,
        matchedKeywords: ["append-only-ledger", "idempotency", "multi-tenant", "optimistic-locking"],
      },
      routes: { count: 2, samples: ["/dispatch", "/my-inventory"] },
    },
    trips: [
      { dimension: "models", level: "required", threshold: 5, observed: 5 },
      { dimension: "acs", level: "required", threshold: 20, observed: 25 },
      { dimension: "multipliers", level: "required", threshold: 4, observed: 4 },
    ],
    rationale:
      "Design is xlarge. Observed: 5 models, 2 endpoints, 25 ACs, 4 ACs with complexity multipliers, 2 routes. REQUIRED-threshold trips: models=5>=5; acs=25>=20; multipliers=4>=4. Recommendation: decompose into 2-4 child builds before Plan, OR narrow the design and re-run Ideate.",
  });

  it("renders with the 'required' tone", () => {
    render(<DecompositionGateBanner assessment={daleAssessment} />);
    const banner = screen.getByTestId("decomposition-gate-banner");
    expect(banner).toHaveAttribute("data-tone", "required");
    expect(screen.getByText(/Decomposition required/i)).toBeInTheDocument();
  });

  it("uses stronger 'bigger than fits in one build' headline copy", () => {
    render(<DecompositionGateBanner assessment={daleAssessment} />);
    expect(screen.getByText(/bigger than fits in one build/i)).toBeInTheDocument();
    expect(screen.queryByText(/Worth considering/i)).not.toBeInTheDocument();
  });

  it("renders each required-tier trip as a separate list item", () => {
    render(<DecompositionGateBanner assessment={daleAssessment} />);
    const tripsList = screen.getByText("Threshold trips").parentElement;
    expect(tripsList).toBeTruthy();
    expect(tripsList!.textContent).toMatch(/models = 5/);
    expect(tripsList!.textContent).toMatch(/acs = 25/);
    expect(tripsList!.textContent).toMatch(/multipliers = 4/);
  });

  it("renders the Dale-specific observation counts", () => {
    render(<DecompositionGateBanner assessment={daleAssessment} />);
    const banner = screen.getByTestId("decomposition-gate-banner");
    expect(banner.textContent).toMatch(/5 DB models/);
    expect(banner.textContent).toMatch(/25 acceptance criteria/);
    expect(banner.textContent).toMatch(/4 ACs with complexity multipliers/);
  });

  it("renders the deterministic rationale naming the required-tier trips", () => {
    render(<DecompositionGateBanner assessment={daleAssessment} />);
    expect(screen.getByText(/REQUIRED-threshold trips/)).toBeInTheDocument();
  });
});

describe("DecompositionGateBanner — defensive presentation", () => {
  it("handles empty trips array gracefully (renders no trips block)", () => {
    const assessment = makeAssessment({
      decision: "decompose-recommended",
      trips: [],
      rationale: "Design is large.",
    });
    render(<DecompositionGateBanner assessment={assessment} />);
    expect(screen.queryByText("Threshold trips")).not.toBeInTheDocument();
  });

  it("handles empty rationale (renders no rationale paragraph)", () => {
    const assessment = makeAssessment({
      decision: "decompose-required",
      rationale: "",
    });
    render(<DecompositionGateBanner assessment={assessment} />);
    // Banner still renders; rationale block is suppressed when empty.
    expect(screen.getByTestId("decomposition-gate-banner")).toBeInTheDocument();
  });
});

describe("DecompositionGateBanner — Phase 4b CTAs", () => {
  const requiredAssessment = makeAssessment({
    decision: "decompose-required",
    trips: [{ dimension: "models", level: "required", threshold: 5, observed: 5 }],
  });
  const recommendedAssessment = makeAssessment({
    decision: "decompose-recommended",
    trips: [{ dimension: "models", level: "recommend", threshold: 3, observed: 3 }],
  });

  it("renders 'Propose splits' button when onProposeSplits is wired (required tier)", () => {
    const onProposeSplits = vi.fn();
    render(
      <DecompositionGateBanner
        assessment={requiredAssessment}
        onProposeSplits={onProposeSplits}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /propose splits/i }));
    expect(onProposeSplits).toHaveBeenCalledTimes(1);
  });

  it("renders 'Propose splits' on recommended tier too (no override path though)", () => {
    const onProposeSplits = vi.fn();
    render(
      <DecompositionGateBanner
        assessment={recommendedAssessment}
        onProposeSplits={onProposeSplits}
      />,
    );
    expect(screen.getByRole("button", { name: /propose splits/i })).toBeInTheDocument();
  });

  it("renders 'Keep as one build' override path only on required tier", () => {
    const onRecordOverride = vi.fn();
    render(
      <DecompositionGateBanner
        assessment={recommendedAssessment}
        onRecordOverride={onRecordOverride}
      />,
    );
    expect(screen.queryByRole("button", { name: /keep as one build/i })).not.toBeInTheDocument();
  });

  it("reveals the rationale input on 'Keep as one build' click and submits on click", () => {
    const onRecordOverride = vi.fn();
    render(
      <DecompositionGateBanner
        assessment={requiredAssessment}
        onProposeSplits={vi.fn()}
        onRecordOverride={onRecordOverride}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /keep as one build/i }));
    const input = screen.getByLabelText(/override rationale/i);
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "Single tech ships this end-to-end." } });
    fireEvent.click(screen.getByRole("button", { name: /record override/i }));
    expect(onRecordOverride).toHaveBeenCalledWith("Single tech ships this end-to-end.");
  });

  it("disables 'Record override' submit when input is empty/whitespace", () => {
    const onRecordOverride = vi.fn();
    render(
      <DecompositionGateBanner
        assessment={requiredAssessment}
        onProposeSplits={vi.fn()}
        onRecordOverride={onRecordOverride}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /keep as one build/i }));
    const submit = screen.getByRole("button", { name: /record override/i });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/override rationale/i), {
      target: { value: "   " },
    });
    expect(submit).toBeDisabled();
  });

  it("renders 'Override recorded' chip instead of action row when override exists", () => {
    render(
      <DecompositionGateBanner
        assessment={requiredAssessment}
        onProposeSplits={vi.fn()}
        onRecordOverride={vi.fn()}
        existingOverride={{
          rationale: "Solo dev; coordination cost > benefit.",
          recordedAt: "2026-05-24T20:00:00.000Z",
          recordedByUserId: "user-1",
          recordedByAgentId: null,
        }}
      />,
    );
    expect(screen.getByText(/Override recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/Solo dev; coordination cost/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /propose splits/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /keep as one build/i })).not.toBeInTheDocument();
  });

  it("disables both CTAs when actionsDisabled=true", () => {
    render(
      <DecompositionGateBanner
        assessment={requiredAssessment}
        onProposeSplits={vi.fn()}
        onRecordOverride={vi.fn()}
        actionsDisabled={true}
      />,
    );
    expect(screen.getByRole("button", { name: /propose splits/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /keep as one build/i })).toBeDisabled();
  });

  it("falls back to the Phase 3 'next phase' notice when no CTAs are wired", () => {
    render(<DecompositionGateBanner assessment={requiredAssessment} />);
    expect(
      screen.getByText(/decomposition assistant.*ships in the next phase/i),
    ).toBeInTheDocument();
  });
});
