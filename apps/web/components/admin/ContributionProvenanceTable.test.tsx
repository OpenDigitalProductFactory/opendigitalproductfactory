import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ContributionProvenanceTable } from "./ContributionProvenanceTable";
import type { ContributionProvenanceRow } from "@/lib/actions/hive-contributions";

function row(overrides: Partial<ContributionProvenanceRow>): ContributionProvenanceRow {
  return {
    id: "feature-pack:FP-1",
    source: "feature-pack",
    title: "Shared dispatch workflow",
    sourceLabel: "Feature Pack",
    occurredAt: "2026-07-15T12:00:00.000Z",
    localAvailability: { status: "saved-locally", label: "Saved locally", detail: "Feature Pack exists on this install." },
    privacyDisposition: { status: "approved-to-share", label: "Approved to share", detail: "A public community contribution record exists for this Feature Pack." },
    publication: { status: "sent-community", label: "Sent to community project", detail: "PR #42", url: "https://github.com/example/repo/pull/42" },
    upstreamAcceptance: { status: "under-review", label: "Under review", detail: "The community project has not accepted it yet." },
    ...overrides,
  };
}

describe("ContributionProvenanceTable", () => {
  it("renders all four provenance axes in plain language", () => {
    const html = renderToStaticMarkup(<ContributionProvenanceTable rows={[row({})]} />);

    expect(html).toContain("Shared dispatch workflow");
    expect(html).toContain("Saved locally");
    expect(html).toContain("Approved to share");
    expect(html).toContain("Sent to community project");
    expect(html).toContain("Under review");
    expect(html).toContain("Open contribution");
  });

  it("resolves provenance statuses through the shared report-kit intent registry", () => {
    const html = renderToStaticMarkup(<ContributionProvenanceTable rows={[row({})]} />);

    expect(html).toContain('data-intent="neutral"');
    expect(html).toContain('data-intent="accent"');
  });

  it("renders ambiguous legacy contributions as review work, not as confirmed community acceptance", () => {
    const html = renderToStaticMarkup(<ContributionProvenanceTable rows={[row({
      id: "feature-pack:FP-AMBIGUOUS",
      title: "Ambiguous contribution",
      publication: {
        status: "needs-attention",
        label: "Needs attention",
        detail: "Marked contributed, but no sent-community proof was found.",
      },
      upstreamAcceptance: {
        status: "needs-review",
        label: "Needs provenance review",
        detail: "Legacy status cannot prove whether the community accepted it.",
      },
    })]} />);

    expect(html).toContain("Needs attention");
    expect(html).toContain("Needs provenance review");
    expect(html).not.toContain("Accepted by community");
  });

  it("renders an honest empty state", () => {
    const html = renderToStaticMarkup(<ContributionProvenanceTable rows={[]} />);
    expect(html).toContain("No contribution provenance yet");
  });
});
