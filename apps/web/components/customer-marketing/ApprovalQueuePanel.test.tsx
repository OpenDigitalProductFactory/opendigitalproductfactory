// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("./PublishWordPressButton", () => ({
  PublishWordPressButton: (props: { channelConnected: boolean; draftId: string }) => (
    <div data-testid="wordpress-control" data-connected={String(props.channelConnected)}>{props.draftId}</div>
  ),
}));
vi.mock("./PublishLinkedInButton", () => ({ PublishLinkedInButton: () => null }));
vi.mock("./PublishEmailButton", () => ({ PublishEmailButton: () => null }));
vi.mock("./ApprovalQueueReview", () => ({ ApprovalQueueReview: () => null }));

import { ApprovalQueuePanel } from "./ApprovalQueuePanel";

afterEach(cleanup);

describe("ApprovalQueuePanel WordPress routing", () => {
  it("renders the canonical WordPress publication control for an approved WordPress draft", () => {
    render(
      <ApprovalQueuePanel
        pendingDrafts={[]}
        approvedDrafts={[{
          draftId: "draft-wp-1",
          sourceType: "marketing-asset-task",
          sourceId: null,
          assetTaskTitle: "Adoption day",
          channelId: "wordpress-self-hosted",
          assetType: "wordpress-post",
          status: "approved",
          body: "Join our adoption day this Saturday.",
          bodyFormat: "html",
          createdByAgentId: null,
          createdAt: new Date("2026-08-22T07:00:00.000Z"),
        }]}
        connectedChannels={["wordpress-self-hosted"]}
        inboundMessages={[]}
        category="nonprofit-community"
      />,
    );

    expect(screen.getByTestId("wordpress-control")).toHaveAttribute("data-connected", "true");
    expect(screen.queryByText(/lands in a later phase/i)).toBeNull();
  });
});
