// @vitest-environment jsdom
import "./test-setup";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BusinessBriefPanel } from "./BusinessBriefPanel";
import { DEMO_BUSINESS_BRIEF } from "@/lib/build-studio-demo";

vi.mock("@/lib/actions/build", () => ({
  updateBusinessBuildBrief: vi.fn(),
}));

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

  it("offers a business-language editor for persisted briefs", () => {
    render(
      <BusinessBriefPanel
        brief={{
          ...DEMO_BUSINESS_BRIEF,
          briefId: "BBB-FB-123",
        }}
      />,
    );

    expect(screen.getByRole("button", { name: /edit brief/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/business outcome/i)).toHaveValue(DEMO_BUSINESS_BRIEF.businessOutcome);
    expect(screen.getByLabelText(/affected people/i)).toHaveValue(DEMO_BUSINESS_BRIEF.affectedPeople.join("\n"));
    expect(screen.getByLabelText(/source evidence/i)).toHaveValue(
      DEMO_BUSINESS_BRIEF.sourceEvidence.map((evidence) => evidence.summary).join("\n"),
    );
    expect(screen.getByRole("button", { name: /save brief/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /accept brief/i })).toBeInTheDocument();
  });
});
