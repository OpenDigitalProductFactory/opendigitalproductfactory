import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SeedContributionReviewTable } from "./SeedContributionReviewTable";

describe("SeedContributionReviewTable", () => {
  it("renders the governed decision, scope, rationale, and PR", () => {
    const html = renderToStaticMarkup(<SeedContributionReviewTable rows={[{
      packId: "FP-1",
      title: "Shared banking defaults",
      decision: "vertical-scoped",
      distributionScope: "vertical-scoped",
      applicableScope: ["banking-financial-services"],
      mergeEligible: true,
      mergeReadiness: "ready",
      changedSeedPaths: ["packages/db/src/seed-banking-compliance.ts"],
      rationale: "Limited to the reviewed financial-services vertical.",
      prUrl: "https://github.com/example/repo/pull/42",
      prNumber: 42,
      reviewedAt: "2026-07-11T00:00:00.000Z",
    }]} />);

    expect(html).toContain("Shared banking defaults");
    expect(html).toContain("Vertical scoped");
    expect(html).toContain("banking-financial-services");
    expect(html).toContain("Limited to the reviewed financial-services vertical.");
    expect(html).toContain("PR #42");
  });

  it("renders an honest empty state", () => {
    const html = renderToStaticMarkup(<SeedContributionReviewTable rows={[]} />);
    expect(html).toContain("No seed-changing contributions have been reviewed yet");
  });
});
