// @vitest-environment jsdom

// Publish-confirmation contract (BI-CC580161): before anything posts outside
// DPF, the owner reviews channel, artifact title, audience, and the external
// consequence in one explicit confirmation step.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const actionMocks = vi.hoisted(() => ({
  publishOutboundDraftAction: vi.fn(),
}));
vi.mock("@/app/(shell)/customer/marketing/actions", () => actionMocks);

import { PublishLinkedInButton } from "./PublishLinkedInButton";

afterEach(() => {
  cleanup();
  actionMocks.publishOutboundDraftAction.mockReset();
});

describe("PublishLinkedInButton confirmation step", () => {
  it("shows channel, artifact title, audience, and external consequence before publishing", () => {
    render(
      <PublishLinkedInButton
        draftId="draft-1"
        channelConnected
        channelId="linkedin-personal-social"
        artifactTitle="Seasonal menu launch"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /publish to linkedin/i }));

    const panel = screen.getByTestId("publish-confirm-panel");
    expect(panel.textContent).toContain("LinkedIn");
    expect(panel.textContent).toContain("Seasonal menu launch");
    expect(panel.textContent).toMatch(/audience/i);
    expect(panel.textContent).toMatch(/posts outside DPF/i);
    // Nothing has been published yet — the first click only opens the review.
    expect(actionMocks.publishOutboundDraftAction).not.toHaveBeenCalled();
  });

  it("publishes only after the explicit confirmation", async () => {
    actionMocks.publishOutboundDraftAction.mockResolvedValue({
      ok: true,
      externalUrl: "https://linkedin.example/post/1",
    });
    render(
      <PublishLinkedInButton draftId="draft-1" channelConnected channelId="linkedin-personal-social" />,
    );

    fireEvent.click(screen.getByRole("button", { name: /publish to linkedin/i }));
    fireEvent.click(screen.getByRole("button", { name: /yes, publish to linkedin/i }));

    await waitFor(() => expect(actionMocks.publishOutboundDraftAction).toHaveBeenCalledWith("draft-1"));
    expect(await screen.findByTestId("publish-success-link")).toBeTruthy();
  });

  it("keeps the draft when the owner backs out of the review", () => {
    render(
      <PublishLinkedInButton draftId="draft-1" channelConnected channelId="linkedin-personal-social" />,
    );

    fireEvent.click(screen.getByRole("button", { name: /publish to linkedin/i }));
    fireEvent.click(screen.getByRole("button", { name: /keep as draft/i }));

    expect(screen.queryByTestId("publish-confirm-panel")).toBeNull();
    expect(screen.getByRole("button", { name: /publish to linkedin/i })).toBeTruthy();
    expect(actionMocks.publishOutboundDraftAction).not.toHaveBeenCalled();
  });

  it("still hard-blocks off-archetype content ahead of any confirmation", () => {
    render(
      <PublishLinkedInButton
        draftId="draft-1"
        channelConnected
        channelId="linkedin-personal-social"
        fitBlocked
      />,
    );
    expect(screen.getByTestId("publish-blocked-fit")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /publish to linkedin/i })).toBeNull();
  });
});
