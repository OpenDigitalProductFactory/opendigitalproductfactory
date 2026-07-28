// @vitest-environment jsdom
import "@/components/build-studio/test-setup";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DemandActivationControls,
  DemandBoard,
  EstimateControls,
} from "./DemandBoard";
import type { DemandItemView } from "@/lib/demand/board";
import { buildDemandActivationState } from "@/lib/demand/activation";

// Opt this file into React's act() environment so state updates from the
// useTransition flush cleanly (silences the "not configured to support act" warning).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Mock the governed server action — the test verifies the control→action wiring
// and the state→control branching, not the server round-trip (covered by the
// record_effort_estimate pack + estimate-provenance unit tests).
const recordEstimate = vi.fn(async (_input: unknown) => ({ ok: true as const, message: "ok", data: {} }));
vi.mock("@/lib/actions/demand-estimate", () => ({
  recordEstimate: (input: unknown) => recordEstimate(input),
}));
const transitionDemand = vi.fn(async (_input: unknown) => ({
  ok: true as const,
  message: "classified",
}));
const linkEvidenceToDemand = vi.fn(async (_input: unknown) => ({
  ok: true as const,
  message: "linked",
}));
vi.mock("@/lib/actions/demand-activation", () => ({
  transitionDemand: (input: unknown) => transitionDemand(input),
  linkEvidenceToDemand: (input: unknown) => linkEvidenceToDemand(input),
  requestDemandFunding: vi.fn(async () => ({
    ok: true as const,
    message: "funded",
  })),
}));

/** Click and flush the useTransition async so the mocked action settles. */
async function click(name: RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

function item(partial: Partial<DemandItemView> & { itemId: string }): DemandItemView {
  return {
    title: partial.itemId,
    status: "open",
    workType: "feature",
    epicId: null,
    demandStage: "screened",
    demandScore: 5,
    demandScoreFramework: "rice",
    effortSize: "medium",
    jobSize: 3,
    impact: 2,
    investmentBucket: "grow",
    estimateAiJobSize: null,
    estimateHumanJobSize: null,
    estimateSource: null,
    estimateAgreed: null,
    claimStatus: null,
    claimedByAgentId: null,
    ...partial,
  };
}

describe("EstimateControls", () => {
  beforeEach(() => recordEstimate.mockClear());

  it("with no estimate yet, offers an AI first-pass and a manual set", () => {
    render(<EstimateControls item={item({ itemId: "A" })} />);
    expect(screen.getByRole("button", { name: /✨ AI estimate/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /✎ estimate/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirm/i })).not.toBeInTheDocument();
  });

  it("hides the AI first-pass when the item has no effort size to project from", () => {
    render(<EstimateControls item={item({ itemId: "A", effortSize: null })} />);
    expect(screen.queryByRole("button", { name: /AI estimate/i })).not.toBeInTheDocument();
  });

  it("requests an AI first-pass with by=ai when 'AI estimate' is clicked", async () => {
    render(<EstimateControls item={item({ itemId: "A" })} />);
    await click(/✨ AI estimate/i);
    expect(recordEstimate).toHaveBeenCalledWith({ itemId: "A", by: "ai" });
  });

  it("on an AI-proposed estimate, offers Confirm (adopt) and Overrule", async () => {
    render(<EstimateControls item={item({ itemId: "B", estimateAiJobSize: 8, estimateSource: "ai" })} />);
    expect(screen.getByText(/est 8 · AI \(proposed\)/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Overrule/i })).toBeInTheDocument();
    await click(/Confirm/i);
    expect(recordEstimate).toHaveBeenCalledWith({ itemId: "B", by: "human", agree: true });
  });

  it("on divergence, offers Use-AI and Keep-mine reconcile actions", async () => {
    render(
      <EstimateControls
        item={item({ itemId: "C", estimateAiJobSize: 8, estimateHumanJobSize: 3, estimateAgreed: false })}
      />,
    );
    expect(screen.getByText(/AI 8 ↔ you 3/)).toBeInTheDocument();
    await click(/Use AI 8/i);
    expect(recordEstimate).toHaveBeenCalledWith({ itemId: "C", by: "human", agree: true });
    await click(/Keep 3/i);
    expect(recordEstimate).toHaveBeenCalledWith({ itemId: "C", by: "human", jobSize: 3, agree: true });
  });

  it("overrule opens an input and submits the typed human estimate", async () => {
    render(<EstimateControls item={item({ itemId: "D", estimateAiJobSize: 8, estimateSource: "ai" })} />);
    await click(/Overrule/i);
    fireEvent.change(screen.getByLabelText(/Effort points/i), { target: { value: "5" } });
    await click(/^Set$/i);
    expect(recordEstimate).toHaveBeenCalledWith({ itemId: "D", by: "human", jobSize: 5, agree: undefined });
  });
});

describe("DemandActivationControls", () => {
  beforeEach(() => {
    transitionDemand.mockClear();
    linkEvidenceToDemand.mockClear();
  });

  it("offers explicit classification for a legacy null-stage item", async () => {
    const demand = item({
      itemId: "BI-LEGACY",
      demandStage: null,
      activation: buildDemandActivationState({
        demandStage: null,
        status: "open",
        problemStatement: null,
        evidenceCount: 0,
        framework: "rice",
        scoreInputs: {},
        investmentBucket: null,
        estimateSource: null,
        estimateAgreed: null,
        estimateDiverged: false,
        fundingDecisionAllowed: false,
      }),
    });

    render(<DemandActivationControls item={demand} />);
    await click(/Classify as demand/i);

    expect(transitionDemand).toHaveBeenCalledWith({
      itemId: "BI-LEGACY",
      to: "raw",
    });
  });

  it("captures reviewed knowledge by stable reference without duplicate title entry", async () => {
    render(
      <DemandActivationControls
        item={item({
          itemId: "BI-EVIDENCE",
          activation: buildDemandActivationState({
            demandStage: "raw",
            status: "open",
            problemStatement: "Booking friction",
            evidenceCount: 0,
            framework: "rice",
            scoreInputs: {},
            investmentBucket: null,
            estimateSource: null,
            estimateAgreed: null,
            estimateDiverged: false,
            fundingDecisionAllowed: false,
          }),
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Link evidence/i }));
    fireEvent.change(screen.getByLabelText(/Stable reference/i), {
      target: { value: "booking-42" },
    });
    await click(/Save evidence link/i);

    expect(linkEvidenceToDemand).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: "BI-EVIDENCE",
        sourceRef: "booking-42",
        title: "",
      }),
    );
  });
});

describe("DemandBoard score explanation", () => {
  it("shows exact score inputs, reviewed evidence, and recent history", () => {
    const activation = buildDemandActivationState({
      demandStage: "shaped",
      status: "open",
      problemStatement: "Guests abandon conference enquiries.",
      evidenceCount: 1,
      framework: "rice",
      scoreInputs: {
        reach: 20,
        impact: 2,
        confidence: 0.8,
        jobSize: 4,
      },
      investmentBucket: "grow",
      estimateSource: "human",
      estimateAgreed: true,
      estimateDiverged: false,
      fundingDecisionAllowed: false,
    });
    render(
      <DemandBoard
        items={[
          item({
            itemId: "BI-EXPLAIN",
            demandStage: "shaped",
            demandScore: 8,
            estimateHumanJobSize: 4,
            estimateSource: "human",
            estimateAgreed: true,
            activation,
            evidenceLinks: [
              {
                evidenceLinkId: "DME-1",
                sourceKind: "booking",
                sourceRef: "booking-42",
                title: "Abandoned conference booking",
                summary: "Guest did not complete the booking.",
                confidence: 0.8,
                reviewedAt: "2026-07-28T00:00:00.000Z",
              },
            ],
            decisionHistory: [
              {
                kind: "demand_scored",
                summary: "Computed rice score 8",
                recordedAt: "2026-07-28T00:00:00.000Z",
                payload: {},
              },
            ],
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Why this score/i }));

    expect(screen.getByText(/reach 20 · impact 2 · confidence 0.8 · jobSize 4/)).toBeInTheDocument();
    expect(screen.getByText(/Abandoned conference booking · booking/)).toBeInTheDocument();
    expect(screen.getByText("Computed rice score 8")).toBeInTheDocument();
  });
});
