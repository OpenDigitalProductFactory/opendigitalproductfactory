// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { createWatch } = vi.hoisted(() => ({ createWatch: vi.fn() }));
vi.mock("@/lib/actions/business-analysis-watch", () => ({
  createBusinessAnalysisWatchAction: createWatch,
}));

import type { ReadyBusinessPerformance } from "@/lib/performance/business-performance-provider";
import { BusinessAnalysisWorkspace } from "./BusinessAnalysisWorkspace";

const performance: ReadyBusinessPerformance = {
  status: "ready",
  organizationId: "org-1",
  archetypeId: "restaurant",
  periodLabel: "Aug 11, 2026",
  periodStart: new Date("2026-08-11T05:00:00.000Z"),
  periodEnd: new Date("2026-08-12T05:00:00.000Z"),
  timezone: "America/Chicago",
  asOf: new Date("2026-08-12T11:30:00.000Z"),
  freshness: "fresh",
  periodState: "finalized",
  availablePeriods: [{ key: "2026-08-11", label: "Aug 11, 2026", selected: true }],
  source: "business-performance-read-model",
  trendPoints: [],
  sections: { headline: ["covers"], operating: [], financial: [], customer: [], workforce: [] },
  metricValues: [{
    key: "covers",
    label: "Covers",
    unit: "count",
    value: 115,
    comparisonValue: 100,
    comparisonDelta: 0.15,
    availability: "available",
    unavailableReason: null,
    definition: "count seated guests",
    definitionVersion: "2026-08-01.2",
    sourceOwner: "restaurant-service",
    sourceWatermark: new Date("2026-08-12T11:30:00.000Z"),
    sourceLineage: { sourceModels: ["HospitalityServiceTurn"] },
  }],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BusinessAnalysisWorkspace", () => {
  it("stays compact by default and previews the exact plan before writing", () => {
    render(<BusinessAnalysisWorkspace performance={performance} watches={[]} />);

    expect(screen.getByText("Performance questions")).toBeTruthy();
    expect(screen.getByText("Performance questions").closest("details")?.open).toBe(false);
    fireEvent.click(screen.getByText("Performance questions"));

    fireEvent.change(screen.getByLabelText("Business question"), {
      target: { value: "Did covers move enough to deserve attention?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review question" }));

    expect(screen.getByText("What DPF understood")).toBeTruthy();
    expect(screen.getAllByText("Covers")).toHaveLength(2);
    expect(screen.getByText("restaurant-service")).toBeTruthy();
    expect(screen.getByText(/PT2H/)).toBeTruthy();
    expect(screen.getByText(/bap1_/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start watching" })).toBeTruthy();
    expect(createWatch).not.toHaveBeenCalled();
  });

  it("shows clarification without offering an executable confirmation", () => {
    render(<BusinessAnalysisWorkspace performance={performance} watches={[]} />);
    fireEvent.click(screen.getByText("Performance questions"));
    fireEvent.change(screen.getByLabelText("Business question"), {
      target: { value: "What changed?" },
    });
    fireEvent.change(screen.getByLabelText("Comparison"), {
      target: { value: "none" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review question" }));

    expect(screen.getByText("Clarify before watching")).toBeTruthy();
    expect(screen.getByText(/requires a comparison basis/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start watching" })).toBeNull();
  });

  it("surfaces only material changes as owner attention", () => {
    render(<BusinessAnalysisWorkspace performance={performance} watches={[{
      taskId: "agent-task-1",
      title: "Watch covers",
      schedule: "0 9 * * 1",
      isActive: true,
      nextRunAt: "2026-08-17T09:00:00.000Z",
      config: {
        schemaVersion: 1,
        plan: {} as never,
        fingerprint: "bap1_1234567890abcdef",
        materiality: { mode: "relative", direction: "either", value: 0.1 },
        baseline: { value: 115, sourceWatermark: "2026-08-12T11:30:00.000Z" },
        lastEvaluation: {
          status: "material-change",
          fingerprint: "bap1_1234567890abcdef",
          metricKey: "covers",
          baselineValue: 100,
          currentValue: 115,
          delta: 0.15,
          evaluatedAt: "2026-08-12T12:00:00.000Z",
          sourceWatermark: "2026-08-12T11:30:00.000Z",
        },
      },
    }]} />);

    expect(screen.getByText("Changes detected")).toBeTruthy();
    expect(screen.getByText(/Covers moved 15%/)).toBeTruthy();
  });
});
