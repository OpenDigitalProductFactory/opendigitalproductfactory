// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  RoutingConformanceFinding,
  RoutingEvidenceConformanceProjection,
} from "@/lib/ai-operations-map/routing-evidence-conformance";
import {
  RoutingArchitectureOverview,
  describeDesignMaturity,
  stationBadgeIntent,
  stationBadgeLabel,
} from "./RoutingArchitectureOverview";

afterEach(() => cleanup());

const EVIDENCE: RoutingEvidenceConformanceProjection = {
  schemaVersion: "ai-routing-evidence/v1",
  designRevision: "ai-routing/v4",
  window: { start: "2026-07-26T12:00:00.000Z", end: "2026-07-26T13:00:00.000Z" },
  coverage: {
    totalDecisions: 4,
    attributedDecisions: 4,
    tracedDecisions: 4,
    correlatedDecisions: 3,
    uncorrelatedDecisions: 1,
    unevidencedDecisions: 1,
    screenCoveredDecisions: 3,
    designBoundDecisions: 3,
    preInstrumentationDecisions: 0,
    instrumentedSince: null,
    unprovenDesignDecisions: 1,
    staleDesignDecisions: 0,
    attributionRate: 1,
    traceRate: 1,
    correlationRate: 0.75,
    screenCoverageRate: 0.75,
    designBindingRate: 0.75,
  },
  metrics: {
    decisionVolume: 4,
    adapterAttempts: 5,
    successfulAttempts: 4,
    errorAttempts: 1,
    fallbackAttempts: 1,
    excludedCandidates: 2,
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.42,
    latencyP50Ms: 300,
    latencyP95Ms: 900,
    capacityLimitedProviders: 0,
    latestEvidenceAt: "2026-07-26T12:59:00.000Z",
    evidenceAgeSeconds: 60,
  },
  providerMetrics: [],
  findings: [
    {
      issueKey: "design-unproven",
      issueType: "ai-routing-design-unproven",
      severity: "warn",
      ownerAction: "none-historical",
      nextAction: "Nothing to do.",
      message: "One decision was not bound to a design revision.",
      count: 1,
      architectureStageId: "record-safe-receipt",
    },
  ],
};

describe("RoutingArchitectureOverview", () => {
  it("shows the five owner stations and switches between Designed, Observed, and Compare", () => {
    render(<RoutingArchitectureOverview evidence={EVIDENCE} initialMode="compare" />);

    expect(screen.getAllByTestId("owner-routing-station")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Designed" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Compare" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Design and evidence together")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Observed" }));
    expect(screen.getByText("What the evidence shows")).toBeTruthy();
  });

  it("opens an evidence-safe station inspector with design sources and closes on Escape", () => {
    render(
      <RoutingArchitectureOverview
        evidence={EVIDENCE}
        initialMode="compare"
        initialFocusStageId="data-policy-gateway"
      />,
    );

    const inspector = screen.getByRole("dialog", { name: "Data safety details" });
    expect(inspector.textContent).toContain("Safe inputs only");
    expect(inspector.textContent).toContain("ai-routing/v4");
    expect(inspector.textContent).toContain("evaluateInferenceDispatchPolicy");
    expect(
      screen.getByRole("link", { name: "Open in Enterprise Architecture" }).getAttribute("href"),
    ).toBe("/ea?focus=data-policy-gateway");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Data safety details" })).toBeNull();
  });

  it("opens an inspector from a 44px station control and renders accessible stage rows", () => {
    render(<RoutingArchitectureOverview evidence={EVIDENCE} initialMode="designed" />);

    const station = screen.getByRole("button", { name: /Eligible & available routes/i });
    expect(station.className).toContain("min-h-11");
    fireEvent.click(station);

    expect(screen.getByRole("dialog", { name: "Eligible & available routes details" })).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("RequestContract compilation")).toBeTruthy();
  });
});

// BI-C8BC9DD1 — severity was computed and then discarded. The station badge read
// `severity === "error" ? "danger" : "warning"`, so an `info` finding rendered as
// an operational warning. Live worst case: station 1 carried exactly one finding,
// `ai-routing-design-unproven` (declared `info`, counting traffic that predates
// the evidence ledger) and showed an amber "171 issue" badge to the owner.
describe("station badge fidelity (BI-C8BC9DD1)", () => {
  const finding = (over: Partial<RoutingConformanceFinding> = {}): RoutingConformanceFinding => ({
    issueKey: "ai-routing-design-unproven",
    issueType: "ai-routing-design-unproven",
    severity: "info",
    message: "Historic traffic does not name the design revision. Count: 171.",
    count: 171,
    architectureStageId: "request",
    ownerAction: "none-historical",
    nextAction: "Nothing to do.",
    ...over,
  });

  it("does not render an info-severity historical finding as a warning", () => {
    expect(stationBadgeIntent([finding()])).toBe("neutral");
  });

  it("counts purely historic traffic as history, not as issues", () => {
    expect(stationBadgeLabel([finding()])).toBe("171 historic");
  });

  it("still escalates a real error to danger", () => {
    expect(stationBadgeIntent([
      finding(),
      finding({
        issueKey: "ai-routing-blocked-path-dispatched",
        issueType: "ai-routing-blocked-path-dispatched",
        severity: "error",
        ownerAction: "platform-defect",
        count: 2,
      }),
    ])).toBe("danger");
  });

  it("warns when actionable warn-severity findings are present", () => {
    expect(stationBadgeIntent([
      finding({
        issueKey: "ai-routing-evidence-missing",
        issueType: "ai-routing-evidence-missing",
        severity: "warn",
        ownerAction: "platform-defect",
        count: 3,
      }),
    ])).toBe("warning");
  });

  it("agrees the noun with the number", () => {
    expect(stationBadgeLabel([
      finding({ severity: "warn", ownerAction: "platform-defect", count: 1 }),
    ])).toBe("1 issue");
    expect(stationBadgeLabel([
      finding({ severity: "warn", ownerAction: "platform-defect", count: 4 }),
    ])).toBe("4 issues");
  });
});

// BI-3006D674. The card rendered `${implemented}/${stages.length} implemented`,
// counting only the `implemented` status. Station 2 holds three `partial` stages
// backed by working code (classifyInferencePayload, evaluateDataPolicy,
// evaluateInferenceDispatchPolicy) and reported "0/6 implemented" — false about
// the codebase, and read by the founder as their own install being broken when
// their routing was healthy.
describe("platform build maturity is not an install score (BI-3006D674)", () => {
  it("never reports zero for a station whose code is partial", () => {
    const label = describeDesignMaturity({ implemented: 0, partial: 3, proposed: 3 });
    expect(label).toBe("3 partial · 3 planned");
    expect(label).not.toMatch(/^0/);
    expect(label).not.toContain("0/6");
  });

  it("names built, partial, and planned separately", () => {
    expect(describeDesignMaturity({ implemented: 3, partial: 4, proposed: 0 }))
      .toBe("3 built · 4 partial");
    expect(describeDesignMaturity({ implemented: 2, partial: 0, proposed: 0 }))
      .toBe("2 built");
  });

  it("omits empty segments rather than printing a zero for them", () => {
    const label = describeDesignMaturity({ implemented: 0, partial: 0, proposed: 5 });
    expect(label).toBe("5 planned");
    expect(label).not.toContain("built");
    expect(label).not.toContain("partial");
  });

  it("degrades to a word, never a bare ratio, when a station has no stages", () => {
    expect(describeDesignMaturity({ implemented: 0, partial: 0, proposed: 0 })).toBe("none");
  });
});
