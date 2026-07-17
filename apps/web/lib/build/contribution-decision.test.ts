import { describe, expect, it } from "vitest";

import { deriveContributionDecisionView } from "./contribution-decision";

describe("deriveContributionDecisionView", () => {
  it("shows an explicit keep-local decision in plain language", () => {
    const view = deriveContributionDecisionView({
      disposition: "private",
      dispositionSuggested: "shareable",
      dispositionSuggestionReason: "Looks reusable across healthcare and professional services.",
    });

    expect(view.currentLabel).toBe("Kept on this system");
    expect(view.recommendationLabel).toBe("Recommended: Share with the community");
    expect(view.canShare).toBe(true);
    expect(view.reason).toMatch(/healthcare and professional services/i);
  });

  it("shows a share decision separately from whether the upstream PR is done", () => {
    const view = deriveContributionDecisionView({
      disposition: "shareable",
      dispositionSuggested: "shareable",
      dispositionSuggestionReason: "Broad market fit.",
    });

    expect(view.currentLabel).toBe("Approved to share");
    expect(view.recommendationLabel).toBe("Recommended: Share with the community");
    expect(view.canShare).toBe(true);
  });

  it("defaults to a keep recommendation when no assessment has been captured", () => {
    const view = deriveContributionDecisionView({
      disposition: "private",
      dispositionSuggested: null,
      dispositionSuggestionReason: null,
    });

    expect(view.recommendationLabel).toBe("Recommended: Keep on my system");
    expect(view.reason).toMatch(/No contribution assessment/i);
  });
});
