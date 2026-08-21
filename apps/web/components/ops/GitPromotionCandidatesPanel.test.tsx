// @vitest-environment jsdom
import "@/test-setup";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GitPromotionCandidatesPanel } from "./GitPromotionCandidatesPanel";

const baseCandidate = {
  id: "c1",
  candidateId: "GPC-123456789ABC",
  provider: "github",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  branch: "main",
  afterSha: "abcdef1234567890",
  status: "sandbox-verification-complete",
  statusReason: null,
  sandboxProviderId: "local-docker",
  sandboxId: "dpf-sandbox-GPC-123456789ABC",
  verificationStartedAt: "2026-05-11T18:00:00.000Z",
  verificationCompletedAt: "2026-05-11T18:05:00.000Z",
  verificationResult: {
    exitCode: 0,
    durationMs: 300000,
    stdout: "typecheck ok\nbuild ok",
    stderr: "",
  },
  createdAt: "2026-05-11T17:59:00.000Z",
  promotionReview: null,
};

describe("GitPromotionCandidatesPanel", () => {
  it("renders sandbox-verified Git candidates with source and evidence", () => {
    render(<GitPromotionCandidatesPanel candidates={[baseCandidate]} createReviewAction={() => undefined} />);

    expect(screen.getByText("Git update candidates")).toBeInTheDocument();
    expect(screen.getByText("OpenDigitalProductFactory/opendigitalproductfactory")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("abcdef123456")).toBeInTheDocument();
    expect(screen.getByText("Sandbox verified")).toBeInTheDocument();
    expect(screen.getByText("local-docker")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create review" })).toBeInTheDocument();
    expect(screen.getByText(/typecheck ok/)).toBeInTheDocument();
  });

  it("shows linked promotion review details instead of a duplicate handoff action", () => {
    render(
      <GitPromotionCandidatesPanel
        candidates={[
          {
            ...baseCandidate,
            promotionReview: {
              promotionId: "CP-12345678",
              promotionStatus: "pending",
              rfcId: "RFC-2026-12345678",
              rfcStatus: "draft",
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("CP-12345678")).toBeInTheDocument();
    expect(screen.getByText("RFC-2026-12345678 - pending")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create review" })).not.toBeInTheDocument();
  });

  it("renders a quiet empty state", () => {
    render(<GitPromotionCandidatesPanel candidates={[]} />);

    expect(screen.getByText("No Git update candidates yet.")).toBeInTheDocument();
  });
});
