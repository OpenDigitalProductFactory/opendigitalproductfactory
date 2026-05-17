import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DecisionPerspectiveGatePanel } from "./DecisionPerspectiveGatePanel";
import type { DecisionInteractionGateView } from "@/lib/decision-perspective/types";

function interaction(overrides: Partial<DecisionInteractionGateView> = {}): DecisionInteractionGateView {
  return {
    interactionId: "DI-ABC123",
    profileId: "mark-dpf-platform",
    profileVersionId: "DPV-1",
    domainClass: "plan-readiness",
    outcomeType: "recommend",
    confidenceBefore: 0.88,
    confidenceAfter: 0.88,
    confidenceScore: 0.88,
    materialCount: 2,
    principleConflict: false,
    rationale: "The plan is backed by current platform doctrine and a passing review.",
    createdAt: new Date("2026-05-17T20:00:00.000Z"),
    sources: [
      {
        materialId: "DPM-1",
        sourceType: "principle",
        summary: "Prefer architecture over shortcuts.",
        effectiveWeight: 0.9,
      },
    ],
    escalationCaptured: false,
    deferralCaptured: false,
    ...overrides,
  };
}

describe("DecisionPerspectiveGatePanel", () => {
  it("renders nothing before WWMD has been invoked", () => {
    const html = renderToStaticMarkup(
      <DecisionPerspectiveGatePanel interaction={null} onCapture={vi.fn()} />,
    );

    expect(html).toBe("");
  });

  it("renders a recommended decision with confidence tier and source labels", () => {
    const html = renderToStaticMarkup(
      <DecisionPerspectiveGatePanel interaction={interaction()} onCapture={vi.fn()} />,
    );

    expect(html).toContain("WWMD gate");
    expect(html).toContain("Recommended");
    expect(html).toContain("High confidence");
    expect(html).toContain("Before High");
    expect(html).toContain("After High");
    expect(html).toContain("1 source");
    expect(html).toContain("principle");
    expect(html).toContain("DPV-1");
    expect(html).not.toContain("0.88");
  });

  it("renders escalation prompt and capture button for blocked decisions", () => {
    const html = renderToStaticMarkup(
      <DecisionPerspectiveGatePanel
        interaction={interaction({
          outcomeType: "escalate",
          confidenceScore: 0.6,
          confidenceBefore: 0.78,
          confidenceAfter: 0.6,
          principleConflict: true,
          sources: [],
        })}
        onCapture={vi.fn()}
      />,
    );

    expect(html).toContain("Escalation required");
    expect(html).toContain("Medium confidence");
    expect(html).toContain("Escalation open");
    expect(html).toContain("Principle conflict");
    expect(html).toContain("No sources");
    expect(html).toContain("Capture human direction");
    expect(html).toContain("data-testid=\"wwmd-gate-capture\"");
  });

  it("renders deferral prompt and capture button for coverage gaps", () => {
    const html = renderToStaticMarkup(
      <DecisionPerspectiveGatePanel
        interaction={interaction({
          outcomeType: "defer",
          confidenceScore: 0.2,
          confidenceBefore: 0.2,
          confidenceAfter: 0.2,
          sources: [],
        })}
        onCapture={vi.fn()}
      />,
    );

    expect(html).toContain("Coverage gap - deferred");
    expect(html).toContain("Low confidence");
    expect(html).toContain("Deferral open");
    expect(html).toContain("Capture missing evidence");
    expect(html).toContain("No sources");
  });
});
