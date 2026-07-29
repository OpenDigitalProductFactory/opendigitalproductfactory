import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductOutcomes } from "./ProductOutcomes";

vi.mock("@/lib/actions/product-outcomes", () => ({
  createProductObjectiveAction: vi.fn(),
  reviewProductObjectiveAction: vi.fn(),
  recordProductOutcomeObservationAction: vi.fn(),
  transitionProductObjectiveAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("ProductOutcomes", () => {
  it("guides a small business to define the first useful outcome without OKR jargon", () => {
    render(
      <ProductOutcomes
        product={{ id: "product-1", name: "Salon services" }}
        objectives={[]}
        requestedAt={new Date("2026-07-28T12:00:00.000Z")}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "What should improve?" }),
    ).toBeTruthy();
    expect(screen.getByText(/starting point, the change you hope to see/i)).toBeTruthy();
    expect(screen.queryByText(/key result/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Define the first outcome" }),
    ).toBeTruthy();
  });

  it("leads with overdue reviews and labels insufficient evidence honestly", () => {
    render(
      <ProductOutcomes
        product={{ id: "product-1", name: "Conference events" }}
        requestedAt={new Date("2026-07-28T12:00:00.000Z")}
        objectives={[
          {
            objectiveId: "OBJ-ONE",
            title: "Increase qualified conference enquiries",
            problemStatement: "Conference demand is inconsistent.",
            outcomeHypothesis: "Clear packages will increase qualified enquiries.",
            status: "active",
            owner: null,
            measureKind: "number",
            measureDefinition: "Qualified conference enquiries per month",
            measureUnit: "enquiries/month",
            baselineValue: null,
            targetValue: 12,
            baselineNarrative: null,
            targetNarrative: null,
            reviewCadence: "monthly",
            reviewAt: new Date("2026-07-20T00:00:00.000Z"),
            reviewedAt: null,
            createdAt: new Date("2026-07-01T00:00:00.000Z"),
            updatedAt: new Date("2026-07-01T00:00:00.000Z"),
            observations: [],
            contributingWork: [],
            posture: {
              availability: "insufficient-evidence",
              state: "unknown",
              reason: "baseline-missing",
            },
            reviewDue: true,
            postureChanged: false,
          },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Needs review" })).toBeTruthy();
    expect(screen.getAllByText("Baseline missing").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Review outcome" })).toBeTruthy();
  });

  it("shows evidence provenance, contributing work, and correction history", () => {
    render(
      <ProductOutcomes
        product={{ id: "product-1", name: "Private dining" }}
        requestedAt={new Date("2026-07-28T12:00:00.000Z")}
        objectives={[
          {
            objectiveId: "OBJ-TWO",
            title: "Grow private-event bookings",
            problemStatement: null,
            outcomeHypothesis: "A clearer private-event offer will convert more enquiries.",
            status: "active",
            owner: { principalId: "PRN-OWNER", displayName: "Owner operator" },
            measureKind: "number",
            measureDefinition: "Confirmed private events per month",
            measureUnit: "events/month",
            baselineValue: 3,
            targetValue: 6,
            baselineNarrative: null,
            targetNarrative: null,
            reviewCadence: "monthly",
            reviewAt: new Date("2026-08-20T00:00:00.000Z"),
            reviewedAt: null,
            createdAt: new Date("2026-07-01T00:00:00.000Z"),
            updatedAt: new Date("2026-07-28T00:00:00.000Z"),
            observations: [
              {
                observationId: "OBS-NEW",
                observedAt: new Date("2026-07-27T00:00:00.000Z"),
                numericValue: 4,
                narrative: "Booking ledger reconciled.",
                sourceKind: "booking",
                sourceRef: "booking-ledger:2026-07",
                confidence: 0.95,
                recordedBy: null,
                supersedesObservationId: "OBS-OLD",
                supersededByObservationId: null,
                createdAt: new Date("2026-07-28T00:00:00.000Z"),
              },
            ],
            contributingWork: [
              {
                itemId: "BI-EVENTS",
                title: "Publish private-event packages",
                status: "in-progress",
                contributionKind: "delivery",
              },
            ],
            posture: {
              availability: "available",
              direction: "increase",
              state: "improving",
              progress: 1 / 3,
              latestValue: 4,
            },
            reviewDue: false,
            postureChanged: true,
          },
        ]}
      />,
    );
    expect(screen.getByText("Booking ledger reconciled.")).toBeTruthy();
    expect(screen.getByText(/booking-ledger:2026-07/)).toBeTruthy();
    expect(screen.getByText("Publish private-event packages")).toBeTruthy();
    expect(screen.getByText(/corrects OBS-OLD/i)).toBeTruthy();
  });
});
