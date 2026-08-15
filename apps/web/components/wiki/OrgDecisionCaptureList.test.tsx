// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const captureOrgDecisionOutcome = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/org-decision-capture", () => ({ captureOrgDecisionOutcome }));

import { OrgDecisionCaptureList } from "./OrgDecisionCaptureList";

beforeEach(() => {
  refresh.mockReset();
  captureOrgDecisionOutcome.mockReset();
});

afterEach(cleanup);

describe("OrgDecisionCaptureList", () => {
  it("politely announces a post-submit warning", async () => {
    captureOrgDecisionOutcome.mockResolvedValue({
      ok: true,
      resolvedCount: 2,
      standingPromoted: false,
      warning: "The standing answer could not be saved.",
    });

    render(
      <OrgDecisionCaptureList
        decisions={[
          {
            interactionId: "DI-1",
            question: "What should the business do?",
            riskTier: "medium",
            outcomeType: "escalate",
            createdAt: "2026-08-08T12:00:00.000Z",
            occurrenceCount: 2,
          },
        ]}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("What should the business do?"), {
      target: { value: "Restore access immediately." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));

    await waitFor(() => expect(captureOrgDecisionOutcome).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
