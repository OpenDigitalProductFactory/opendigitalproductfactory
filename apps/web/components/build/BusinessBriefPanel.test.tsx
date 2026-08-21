// @vitest-environment jsdom
import "@/test-setup";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BusinessBriefPanel } from "./BusinessBriefPanel";
import { buildBusinessBuildBrief } from "@/lib/build/business-build-brief";
import type { FeatureBrief } from "@/lib/feature-build-types";

// Local fixture. Previously imported from lib/build-studio-demo, which existed
// only to feed the retired `/build?v=2` prototype (BI-101C107C); a production
// component's test should not depend on a demo surface's fixtures.
const FEATURE_BRIEF: FeatureBrief = {
  title: "Tenant API key rotation",
  description:
    "Tenant owners need to rotate API keys without losing access for live tenants.",
  portfolioContext: "Platform governance",
  targetRoles: ["Tenant owner", "Platform administrator"],
  inputs: ["Existing Settings API Keys workflow", "Customer downtime incident notes"],
  dataNeeds: "Key status, expiration window, owner, old key id, new key id, and audit event.",
  acceptanceCriteria: [
    "Tenant owners can rotate from Settings without downtime.",
    "Old keys stop working after the agreed grace period.",
    "Every rotation is visible in the audit log.",
  ],
};

const DEMO_BUSINESS_BRIEF = buildBusinessBuildBrief({
  source: "existing_example",
  featureBrief: FEATURE_BRIEF,
  exampleToEmulate: "Existing Settings invite flow",
  constraints: ["Do not break active tenant API traffic."],
});

const updateBusinessBuildBrief = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/build", () => ({
  updateBusinessBuildBrief,
}));

describe("BusinessBriefPanel", () => {
  it("renders the business outcome before technical interpretation", () => {
    render(<BusinessBriefPanel brief={DEMO_BUSINESS_BRIEF} />);

    expect(screen.getByRole("region", { name: DEMO_BUSINESS_BRIEF.title })).toBeInTheDocument();
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

  it("resets editable draft fields when the selected brief identity changes", () => {
    const firstBrief = {
      ...DEMO_BUSINESS_BRIEF,
      briefId: "BBB-FIRST",
      title: "First Change brief",
      businessOutcome: "First Change outcome",
    };
    const secondBrief = {
      ...DEMO_BUSINESS_BRIEF,
      briefId: "BBB-SECOND",
      title: "Second Change brief",
      businessOutcome: "Second Change outcome",
    };
    const { rerender } = render(<BusinessBriefPanel brief={firstBrief} />);

    fireEvent.change(screen.getByLabelText(/business outcome/i), {
      target: { value: "Unsaved First Change draft" },
    });
    rerender(<BusinessBriefPanel brief={secondBrief} />);
    expect(screen.getByLabelText(/business outcome/i)).toHaveValue("Second Change outcome");

    rerender(<BusinessBriefPanel brief={firstBrief} />);
    expect(screen.getByLabelText(/business outcome/i)).toHaveValue("First Change outcome");
  });

  it("lets a non-developer mark evidence as an existing working example", async () => {
    updateBusinessBuildBrief.mockResolvedValue(undefined);
    const onSaved = vi.fn();

    render(
      <BusinessBriefPanel
        onSaved={onSaved}
        brief={{
          ...DEMO_BUSINESS_BRIEF,
          briefId: "BBB-FB-123",
          intakeSource: "artifact_reference",
          sourceEvidence: [
            {
              kind: "existing_example",
              label: "Employee setup flow",
              summary: "Employee setup flow",
              copy: ["guided checklist"],
              adapt: ["approval rules"],
              avoid: ["HR-only labels"],
            },
          ],
        }}
      />,
    );

    expect(screen.getByLabelText(/reference type/i)).toHaveValue("existing_example");
    expect(screen.getByLabelText(/copy, adapt, avoid/i)).toHaveValue(
      "Copy: guided checklist\nAdapt: approval rules\nAvoid: HR-only labels",
    );

    fireEvent.click(screen.getByRole("button", { name: /save brief/i }));

    await waitFor(() => {
      expect(updateBusinessBuildBrief).toHaveBeenCalledWith(
        expect.objectContaining({
          briefId: "BBB-FB-123",
          intakeSource: "existing_example",
          evidenceKind: "existing_example",
          copyAdaptAvoidText: "Copy: guided checklist\nAdapt: approval rules\nAvoid: HR-only labels",
        }),
      );
      expect(onSaved).toHaveBeenCalledOnce();
    });
  });
});
