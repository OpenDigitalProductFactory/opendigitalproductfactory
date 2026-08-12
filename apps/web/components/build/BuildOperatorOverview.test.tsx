import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BuildOperatorOverview } from "./BuildOperatorOverview";

describe("BuildOperatorOverview", () => {
  it("keeps the default hierarchy outcome-first and business-safe", () => {
    const html = renderToStaticMarkup(
      <BuildOperatorOverview
        title="Reduce missed invoice follow-ups"
        outcome="Remind account owners before an invoice becomes overdue."
        phase="review"
        status={{
          whatIsBeingBuilt: "Reduce missed invoice follow-ups",
          lifecyclePosition: "Checking the work",
          worker: "Build Studio",
          evidence: "Implementation is complete and verification is running.",
          technicalEvidence: "WC-123 on feat/invoice-reminders",
          nextAction: "No action needed while checks run.",
          owner: "Build Studio",
          needsYou: false,
        }}
      />,
    );

    expect(html).toContain('data-testid="build-studio-operator-outcome"');
    expect(html).toContain("Reduce missed invoice follow-ups");
    expect(html).toContain("Remind account owners before an invoice becomes overdue.");
    expect(html).toContain('data-testid="build-studio-operator-status"');
    expect(html).toContain("Checking the work");
    expect(html).toContain('data-testid="build-studio-operator-next-action"');
    expect(html).toContain("No action needed while checks run.");
    expect(html).toContain('data-testid="build-studio-activity-story"');
    expect(html).not.toContain("WC-123");
    expect(html).not.toContain("feat/invoice-reminders");
  });

  it("makes an operator decision visually explicit without exposing technical evidence", () => {
    const html = renderToStaticMarkup(
      <BuildOperatorOverview
        title="Choose delivery policy"
        outcome="Agree how urgent deliveries should be prioritized."
        phase="plan"
        status={{
          whatIsBeingBuilt: "Choose delivery policy",
          lifecyclePosition: "Waiting for your decision",
          worker: "Build Studio",
          evidence: "Two safe options are ready.",
          nextAction: "Choose the preferred delivery policy.",
          owner: "Operator",
          needsYou: true,
        }}
      />,
    );

    expect(html).toContain("Needs you");
    expect(html).toContain("Choose the preferred delivery policy.");
  });

  it("shows capacity, elapsed time, and the leave-and-return expectation as one owner state", () => {
    const html = renderToStaticMarkup(
      <BuildOperatorOverview
        title="Improve Build Studio progress"
        outcome="Make long-running work understandable."
        phase="ideate"
        status={{
          whatIsBeingBuilt: "Improve Build Studio progress",
          lifecyclePosition: "Waiting for AI capacity",
          worker: "The AI service is briefly unavailable",
          evidence: "Build Studio did not receive a usable response.",
          nextAction: "Retry when convenient.",
          owner: "owner",
          needsYou: true,
          ownerState: "waiting-capacity",
          elapsedLabel: "Waiting for 2 minutes",
          expectation: "You can leave this page and return. Build Studio will show the latest result.",
        }}
      />,
    );

    expect(html).toContain("Capacity wait");
    expect(html).toContain("Waiting for 2 minutes");
    expect(html).toContain("You can leave this page and return");
    expect(html).not.toContain(">Needs you<");
  });
});
