// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const actionMocks = vi.hoisted(() => ({ publishOutboundDraftAction: vi.fn() }));
vi.mock("@/app/(shell)/customer/marketing/actions", () => actionMocks);

import { PublishWordPressButton } from "./PublishWordPressButton";

afterEach(() => {
  cleanup();
  actionMocks.publishOutboundDraftAction.mockReset();
});

describe("PublishWordPressButton", () => {
  it("routes a disconnected operator to the canonical provider page", () => {
    render(<PublishWordPressButton draftId="draft-1" channelConnected={false} />);

    expect(screen.getByRole("link", { name: /connect wordpress first/i })).toHaveAttribute(
      "href",
      "/platform/tools/integrations/wordpress",
    );
    expect(screen.queryByRole("button", { name: /create wordpress draft/i })).toBeNull();
  });

  it("previews the draft-only consequence before calling the publication action", () => {
    render(
      <PublishWordPressButton
        draftId="draft-1"
        channelConnected
        artifactTitle="Adoption day this Saturday"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /create wordpress draft/i }));

    const preview = screen.getByTestId("wordpress-publish-preview");
    expect(preview).toHaveTextContent("Adoption day this Saturday");
    expect(preview).toHaveTextContent(/saved as a WordPress draft/i);
    expect(preview).toHaveTextContent(/will not be public/i);
    expect(actionMocks.publishOutboundDraftAction).not.toHaveBeenCalled();
  });

  it("publishes only after explicit confirmation and renders the receipt URL", async () => {
    actionMocks.publishOutboundDraftAction.mockResolvedValue({
      ok: true,
      publicationId: "pub-1",
      externalUrl: "https://rescue.example/?p=42",
    });
    render(<PublishWordPressButton draftId="draft-1" channelConnected />);

    fireEvent.click(screen.getByRole("button", { name: /create wordpress draft/i }));
    fireEvent.click(screen.getByRole("button", { name: /yes, create wordpress draft/i }));

    await waitFor(() => expect(actionMocks.publishOutboundDraftAction).toHaveBeenCalledWith("draft-1"));
    expect(await screen.findByTestId("wordpress-publication-receipt")).toHaveAttribute(
      "href",
      "https://rescue.example/?p=42",
    );
  });

  it("blocks unfit content before preview", () => {
    render(<PublishWordPressButton draftId="draft-1" channelConnected fitBlocked />);
    expect(screen.getByTestId("wordpress-publish-blocked-fit")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /create wordpress draft/i })).toBeNull();
  });

  it("never renders a provider-supplied unsafe receipt URL", async () => {
    actionMocks.publishOutboundDraftAction.mockResolvedValue({
      ok: true,
      publicationId: "pub-unsafe",
      externalUrl: "javascript:alert(document.cookie)",
    });
    render(<PublishWordPressButton draftId="draft-1" channelConnected />);

    fireEvent.click(screen.getByRole("button", { name: /create wordpress draft/i }));
    fireEvent.click(screen.getByRole("button", { name: /yes, create wordpress draft/i }));

    await waitFor(() => expect(actionMocks.publishOutboundDraftAction).toHaveBeenCalledOnce());
    expect(screen.queryByRole("link", { name: /draft created/i })).toBeNull();
    expect(screen.getByTestId("wordpress-publication-receipt")).toHaveTextContent(/recorded/i);
  });
});
