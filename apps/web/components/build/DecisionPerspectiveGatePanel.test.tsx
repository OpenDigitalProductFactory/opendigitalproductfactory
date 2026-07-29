// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DecisionPerspectiveGatePanel } from "./DecisionPerspectiveGatePanel";
import type { DecisionInteractionGateView } from "@/lib/decision-perspective/types";

afterEach(() => { cleanup(); });

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
    scoredOptions: null,
    recommendedOptionId: null,
    chosenOptionId: null,
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
    expect(html).toContain("Capture owner direction");
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

  it("renders VoiceRationalePlayer when voiceOutput is provided", () => {
    render(
      <DecisionPerspectiveGatePanel
        interaction={{ ...interaction(), profile: { voiceEnabled: true } }}
        voiceOutput={{ audioStorageKey: "voice/DI-abc/f.mp3", durationMs: 4200 }}
      />
    );
    expect(screen.getByRole("button", { name: /play/i })).toBeTruthy();
  });

  it("renders loading voice player when voiceOutput is null and voiceEnabled is true", () => {
    render(
      <DecisionPerspectiveGatePanel
        interaction={{ ...interaction(), profile: { voiceEnabled: true } }}
        voiceOutput={null}
      />
    );
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("does not render voice player when voiceEnabled is false", () => {
    const { container } = render(
      <DecisionPerspectiveGatePanel
        interaction={{ ...interaction(), profile: { voiceEnabled: false } }}
        voiceOutput={{ audioStorageKey: "voice/DI-abc/f.mp3", durationMs: 4200 }}
      />
    );
    expect(container.querySelector('[aria-label="Play"]')).toBeNull();
  });

  it("collects human direction before submitting an escalation capture", async () => {
    const onCapture = vi.fn().mockResolvedValue(undefined);

    render(
      <DecisionPerspectiveGatePanel
        interaction={interaction({
          outcomeType: "escalate",
          confidenceScore: 0.6,
          confidenceBefore: 0.78,
          confidenceAfter: 0.6,
        })}
        onCapture={onCapture}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Capture owner direction" }));
    fireEvent.change(screen.getByLabelText("Owner direction"), {
      target: { value: "Proceed after the owner confirms the implementation scope." },
    });
    fireEvent.change(screen.getByLabelText("Decision criteria"), {
      target: { value: "Owner accepted scope\nNo unresolved objections" },
    });
    fireEvent.change(screen.getByLabelText("Rationale"), {
      target: { value: "The escalation resolved the ambiguity and preserved the decision criteria." },
    });
    fireEvent.change(screen.getByLabelText("Resolved objections"), {
      target: { value: "Timing concern resolved" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Promote as candidate decision material" }));
    fireEvent.click(screen.getByRole("button", { name: "Save WWMD capture" }));

    await waitFor(() => {
      expect(onCapture).toHaveBeenCalledWith({
        interactionId: "DI-ABC123",
        outcomeType: "escalate",
        answer: "Proceed after the owner confirms the implementation scope.",
        criteriaText: "Owner accepted scope\nNo unresolved objections",
        rationale: "The escalation resolved the ambiguity and preserved the decision criteria.",
        objectionsResolvedText: "Timing concern resolved",
        suggestedSourceTypesText: "",
        candidateMaterial: true,
      });
    });
  });

  it("captures a structured option pick when the gate scored options (BI-6DCF772F)", async () => {
    const onCapture = vi.fn().mockResolvedValue(undefined);

    render(
      <DecisionPerspectiveGatePanel
        interaction={interaction({
          outcomeType: "escalate",
          confidenceScore: 0.6,
          scoredOptions: [
            { id: "proceed", description: "Proceed now", features: {} },
            { id: "revise", description: "Revise the plan", features: {} },
          ],
          recommendedOptionId: "proceed",
        })}
        onCapture={onCapture}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Capture owner direction" }));
    // the picker renders (defaulting to the recommendation); pick the other one
    fireEvent.click(screen.getByRole("radio", { name: /Revise the plan/ }));
    fireEvent.change(screen.getByLabelText("Owner direction"), {
      target: { value: "Revise the plan before proceeding." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save WWMD capture" }));

    await waitFor(() => {
      expect(onCapture).toHaveBeenCalledWith(
        expect.objectContaining({ interactionId: "DI-ABC123", chosenOptionId: "revise" }),
      );
    });
  });

  it("shows no option picker when the gate scored no options — free-text fallback preserved", () => {
    render(
      <DecisionPerspectiveGatePanel
        interaction={interaction({ outcomeType: "escalate", confidenceScore: 0.6 })}
        onCapture={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Capture owner direction" }));
    expect(screen.queryByTestId("wwmd-gate-option-pick")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  });
});
