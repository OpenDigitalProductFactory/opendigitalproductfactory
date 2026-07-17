import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { FeatureBuildRow } from "@/lib/feature-build-types";
import { ReleaseDecisionPanel } from "./ReleaseDecisionPanel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/build-release", () => ({
  executeBuildPromotion: vi.fn(),
  prepareBuildRelease: vi.fn(),
  registerBuildRelease: vi.fn(),
  scheduleBuildPromotion: vi.fn(),
  setBuildChangeDisposition: vi.fn(),
  shareBuildContribution: vi.fn(),
}));

vi.mock("@/lib/actions/build", () => ({
  resumeBuildImplementation: vi.fn(),
}));

function build(overrides: Partial<FeatureBuildRow> = {}): FeatureBuildRow {
  return {
    id: "fb-row",
    buildId: "FB-1",
    title: "Reusable scheduling improvement",
    description: null,
    portfolioId: "portfolio-1",
    originatingBacklogItemId: null,
    brief: null,
    plan: null,
    phase: "ship",
    sandboxId: null,
    sandboxPort: null,
    diffSummary: "diff --git a/apps/web/app/(shell)/storefront/dispatch/page.tsx b/apps/web/app/(shell)/storefront/dispatch/page.tsx",
    diffPatch: "diff --git a/apps/web/app/(shell)/storefront/dispatch/page.tsx b/apps/web/app/(shell)/storefront/dispatch/page.tsx",
    codingProvider: null,
    threadId: null,
    digitalProductId: "dp-1",
    disposition: "private",
    dispositionSuggested: "shareable",
    dispositionSuggestionReason: "Looks useful across service archetypes and carries no business-specific content.",
    product: null,
    createdById: "user-1",
    createdAt: new Date("2026-07-16T00:00:00.000Z"),
    updatedAt: new Date("2026-07-16T00:00:00.000Z"),
    draftApprovedAt: null,
    designDoc: null,
    designReview: null,
    buildPlan: null,
    planReview: null,
    taskResults: null,
    verificationOut: null,
    acceptanceMet: null,
    scoutFindings: null,
    uxTestResults: null,
    uxVerificationStatus: null,
    accountableEmployeeId: null,
    claimedByAgentId: null,
    claimedAt: null,
    claimStatus: null,
    buildExecState: null,
    taxonomyAttribution: null,
    deliberationSummary: null,
    originator: null,
    phaseHandoffs: null,
    happyPathState: { state: "not_applicable", label: "Not applicable", detail: "No happy path state." },
    ...overrides,
  } as FeatureBuildRow;
}

describe("ReleaseDecisionPanel contribution choice", () => {
  it("renders the Keep/Share decision with the coworker recommendation in plain language", () => {
    const html = renderToStaticMarkup(
      <ReleaseDecisionPanel
        build={build()}
        flowState={null}
        portfolios={[{ id: "portfolio-1", slug: "platform", name: "Platform" }]}
      />,
    );

    expect(html).toContain("Community Sharing");
    expect(html).toContain("Kept on this system");
    expect(html).toContain("Recommended: Share with the community");
    expect(html).toContain("Looks useful across service archetypes");
    expect(html).toContain("Keep on my system");
    expect(html).toContain("Share with the community");
    expect(html).not.toContain("Submit Upstream PR");
  });
});
