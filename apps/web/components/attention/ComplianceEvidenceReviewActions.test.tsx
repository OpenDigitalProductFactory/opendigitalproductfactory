// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ComplianceEvidenceReviewActions } from "./ComplianceEvidenceReviewActions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/provider-compliance-evidence-review", () => ({
  reviewProviderComplianceEvidence: vi.fn(),
}));

describe("ComplianceEvidenceReviewActions", () => {
  it("keeps the governed source, cited claims, and both review outcomes together", () => {
    render(<ComplianceEvidenceReviewActions evidence={{
      sourceKey: "openai/business-data-privacy",
      url: "https://openai.com/business-data/",
      claims: [{ claimId: "no-training", summary: "Business data is not used for training by default." }],
    }} />);

    expect(screen.getByRole("link", { name: /open cited source/i }).getAttribute("href"))
      .toBe("https://openai.com/business-data/");
    expect(screen.getByText(/business data is not used/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /confirm still valid/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /flag as changed/i })).toBeTruthy();
  });
});
