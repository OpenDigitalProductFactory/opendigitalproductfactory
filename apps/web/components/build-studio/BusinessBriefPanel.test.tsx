// @vitest-environment jsdom
import "./test-setup";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BusinessBriefPanel } from "./BusinessBriefPanel";
import { DEMO_BUSINESS_BRIEF } from "@/lib/build-studio-demo";

describe("BusinessBriefPanel", () => {
  it("renders the business outcome before technical interpretation", () => {
    render(<BusinessBriefPanel brief={DEMO_BUSINESS_BRIEF} />);

    const outcome = screen.getByText(/business outcome/i);
    const technical = screen.getByText(/how dpf will likely build this/i);

    expect(outcome.compareDocumentPosition(technical)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText(DEMO_BUSINESS_BRIEF.businessOutcome)).toBeInTheDocument();
    expect(screen.getByText(/source evidence/i)).toBeInTheDocument();
    expect(screen.getByText(/success signals/i)).toBeInTheDocument();
  });

  it("shows confidence gaps when the brief still needs business evidence", () => {
    render(
      <BusinessBriefPanel
        brief={{
          ...DEMO_BUSINESS_BRIEF,
          confidence: "medium",
          openQuestions: ["What example should this follow?"],
        }}
      />,
    );

    expect(screen.getByText(/needs clarification/i)).toBeInTheDocument();
    expect(screen.getByText("What example should this follow?")).toBeInTheDocument();
  });
});
