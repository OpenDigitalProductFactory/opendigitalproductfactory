// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProviderTrustEvidencePanel } from "./ProviderTrustEvidencePanel";

afterEach(cleanup);

describe("ProviderTrustEvidencePanel", () => {
  it("shows evidence state, age, expiry, and the safest next action in plain language", () => {
    render(<ProviderTrustEvidencePanel
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
    expect(screen.getByRole("status").textContent).toContain("Action needed");
    expect(screen.getByText("No training on company data")).toBeTruthy();
    expect(screen.getByText(/30 days old/)).toBeTruthy();
    expect(screen.getByText(/Renew or replace/)).toBeTruthy();
  });

  it("does not expose internal evidence ids and explains an empty state", () => {
    const { rerender } = render(<ProviderTrustEvidencePanel
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

    rerender(<ProviderTrustEvidencePanel evidenceStatus="unreviewed" lastReviewedAt={null} claims={[]} />);
    expect(screen.getByText(/No account-specific trust evidence is linked yet/)).toBeTruthy();
  });
});
