// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProviderTrustEvidencePanel } from "./ProviderTrustEvidencePanel";

afterEach(cleanup);

describe("ProviderTrustEvidencePanel", () => {
  it("frames incomplete evidence as a restricted-work limitation, not a provider fault", () => {
    render(<ProviderTrustEvidencePanel
      accountDeclarationSaved
      evidenceStatus="expired"
      lastReviewedAt="2026-06-20T09:00:00.000Z"
      claims={[
        {
          claimKey: "no-training",
          status: "expired",
          evidenceIds: ["evidence-1"],
          evidenceAgeDays: 30,
          expiresAt: "2026-07-19T09:00:00.000Z",
          nextAction: "Renew or replace the expired evidence.",
        },
      ]}
    />);

    expect(screen.getByRole("region", { name: "Provider trust evidence" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("1 restriction");
    expect(screen.getByText(/Account declaration saved/)).toBeTruthy();
    expect(screen.getByText(/restricted work remains blocked/i)).toBeTruthy();
    expect(screen.getByText("No training on company data")).toBeTruthy();
    expect(screen.getByText(/30 days old/)).toBeTruthy();
    expect(screen.getByText(/Renew or replace/)).toBeTruthy();
  });

  it("does not expose internal evidence ids and explains an empty state", () => {
    const { rerender } = render(<ProviderTrustEvidencePanel
      accountDeclarationSaved
      evidenceStatus="contract-uploaded"
      lastReviewedAt="2026-07-20T09:00:00.000Z"
      claims={[{
        claimKey: "dpa-on-file",
        status: "valid",
        evidenceIds: ["sensitive-internal-evidence-id"],
        evidenceAgeDays: 0,
        expiresAt: "2027-07-20T09:00:00.000Z",
        nextAction: "No action required.",
      }]}
    />);

    expect(document.body.textContent).not.toContain("sensitive-internal-evidence-id");
    expect(screen.getByRole("status").textContent).toContain("Current");

    rerender(<ProviderTrustEvidencePanel accountDeclarationSaved={false} evidenceStatus="unreviewed" lastReviewedAt={null} claims={[]} />);
    expect(screen.getByText(/No account-specific trust evidence is linked yet/)).toBeTruthy();
  });

  it("names the available declaration action and the unavailable DPA workflow honestly", () => {
    render(<ProviderTrustEvidencePanel
      accountDeclarationSaved
      evidenceStatus="operator-attested"
      lastReviewedAt="2026-08-31T09:00:00.000Z"
      claims={[
        { claimKey: "enabled-regions", status: "missing", evidenceIds: [], evidenceAgeDays: null, expiresAt: null, nextAction: "Add evidence for this connected account." },
        { claimKey: "dpa-on-file", status: "missing", evidenceIds: [], evidenceAgeDays: null, expiresAt: null, nextAction: "Add evidence for this connected account." },
      ]}
    />);

    expect(screen.getByText(/Save the enabled regions in Connected account and data terms above/)).toBeTruthy();
    expect(screen.getByText(/No DPA evidence workflow is available on this page/)).toBeTruthy();
    expect(screen.getByText(/reviewed supplier contract/i)).toBeTruthy();
  });

  it.each(["missing", "expired", "rejected", "conflicting", "superseded"] as const)(
    "keeps a next action visible for %s evidence",
    (status) => {
      const { unmount } = render(<ProviderTrustEvidencePanel
        accountDeclarationSaved={false}
        evidenceStatus="unreviewed"
        lastReviewedAt={null}
        claims={[{ claimKey: "soc2", status, evidenceIds: [], evidenceAgeDays: null, expiresAt: null, nextAction: `Resolve ${status} evidence.` }]}
      />);
      expect(screen.getByText(new RegExp(`Resolve ${status} evidence`))).toBeTruthy();
      unmount();
    },
  );
});
