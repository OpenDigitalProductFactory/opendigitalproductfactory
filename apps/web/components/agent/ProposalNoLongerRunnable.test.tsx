// Approval convergence PR-C (BI-04E5A511, spec D5, AC-UX C items): a legacy
// proposal whose approval the reference monitor refused shows
// "This request can no longer run as proposed: …" with Decline only, in the
// coworker panel's card and on the Needs-you card.
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  approveProposal: vi.fn(),
  rejectProposal: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/actions/proposals", () => ({
  approveProposal: mocks.approveProposal,
  rejectProposal: mocks.rejectProposal,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { AgentMessageBubble } from "./AgentMessageBubble";
import { proposalAfterApproval } from "./ProposalNoLongerRunnable";
import { CoworkerProposalActions } from "../attention/CoworkerProposalActions";

const REASON = "create_backlog_item rejected: this coworker is not admitted to that room";

function bubble(noLongerRunnable?: string) {
  return renderToStaticMarkup(
    <AgentMessageBubble
      message={{
        id: "msg-1", role: "assistant", content: "I can file that.", agentId: "AGT-COWORKER",
        routeContext: "/workspace", createdAt: "2026-10-13T00:00:00.000Z",
        proposal: {
          proposalId: "AP-1", actionType: "create_backlog_item", parameters: { title: "Fix the gate" },
          status: "proposed", ...(noLongerRunnable ? { noLongerRunnable } : {}),
        },
      }}
      showAgentLabel={false}
      agentName={null}
    />,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("legacy proposal card after a monitor refusal", () => {
  it("panel card: an ordinary pending proposal still offers Approve and Reject", () => {
    const html = bubble();
    expect(html).toContain(">Approve<");
    expect(html).toContain(">Reject<");
    expect(html).not.toContain("can no longer run as proposed");
  });

  it("panel card: a refused proposal says why and offers Decline only (spec C3)", () => {
    const html = bubble(REASON);
    expect(html).toContain("This request can no longer run as proposed: ");
    expect(html).toContain("not admitted to that room");
    expect(html).toContain(">Decline<");
    expect(html).not.toContain(">Reject<");
    expect(html).not.toContain(">Approve<");
  });

  it("Needs-you card: a refusal persisted on the row (after a reload) starts with Decline only", () => {
    render(<CoworkerProposalActions proposalId="AP-1" noLongerRunnable={REASON} />);

    expect(screen.getByRole("status").textContent).toContain("This request can no longer run as proposed: ");
    expect(screen.queryByRole("button", { name: "Approve action" })).toBeNull();
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
  });

  it("Needs-you card: a refused approval keeps the card, says why, and leaves Decline only", async () => {
    mocks.approveProposal.mockResolvedValue({ success: false, error: REASON, noLongerRunnable: true });
    mocks.rejectProposal.mockResolvedValue({ success: true });
    render(<CoworkerProposalActions proposalId="AP-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Approve action" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain(
      "This request can no longer run as proposed: create_backlog_item rejected",
    ));
    expect(screen.queryByRole("button", { name: "Approve action" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();

    // Refusal text can render before the async approval transition settles.
    // Exercise the next decision only when the user can actually press it.
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "Decline" }).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(mocks.rejectProposal).toHaveBeenCalledWith("AP-1", "Owner declined this action"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Action declined."));
  });

  it("Needs-you card: an ordinary failure is still shown as an error with both buttons", async () => {
    mocks.approveProposal.mockResolvedValue({ success: false, error: "hive_unreachable" });
    render(<CoworkerProposalActions proposalId="AP-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Approve action" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("hive_unreachable"));
    expect(screen.getByRole("button", { name: "Approve action" })).toBeTruthy();
  });
});

describe("proposalAfterApproval (the coworker panel's card state)", () => {
  const pending = { proposalId: "AP-1", actionType: "create_backlog_item", parameters: {}, status: "proposed" };

  it("a refusal keeps the card pending and carries the reason", () => {
    expect(proposalAfterApproval(pending, { success: false, error: REASON, noLongerRunnable: true }))
      .toEqual({ ...pending, noLongerRunnable: REASON });
  });

  it("a retryable hold keeps the card pending with Approve (PR-C review finding 3)", () => {
    expect(proposalAfterApproval(pending, { success: false, error: "Pass the review gate first.", retryable: true }))
      .toEqual(pending);
  });

  it("a run ends the card executed or failed, as before", () => {
    expect(proposalAfterApproval(pending, { success: true, resultEntityId: "BI-1" }))
      .toEqual({ ...pending, status: "executed", resultEntityId: "BI-1" });
    expect(proposalAfterApproval(pending, { success: false, error: "hive_unreachable" }))
      .toEqual({ ...pending, status: "failed", resultError: "hive_unreachable" });
  });
});
