// @vitest-environment jsdom

// BI-4E192035 (option B, WWMD DI-DC208379563E) — the chat card for a
// leave.decide proposal states the advisor's recommendation and asks for the
// leave outcome explicitly. "Approve leave" approves and "Deny leave" denies,
// whatever the recommendation was, through the governed leave actions.

import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { namespaceMessages } from "@dpf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { approveLeaveRequest, rejectLeaveRequest, promptDialog } = vi.hoisted(() => ({
  approveLeaveRequest: vi.fn(),
  rejectLeaveRequest: vi.fn(),
  promptDialog: vi.fn(),
}));
vi.mock("@/lib/actions/leave", () => ({ approveLeaveRequest, rejectLeaveRequest }));
vi.mock("@/components/ui/Dialog", () => ({ promptDialog }));

import { AgentMessageBubble } from "./AgentMessageBubble";
import { LeaveDecisionProposalCard } from "./LeaveDecisionProposalCard";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";

// The shell layout provides the approvals namespace around the coworker.
const render = (ui: ReactElement) =>
  rtlRender(
    <MessagesProvider locale="en-US" messages={{ approvals: namespaceMessages("en-US", "approvals") }}>
      {ui}
    </MessagesProvider>,
  );

const params = (recommendation: "approve" | "deny" | "escalate") => ({
  requestId: "LR-1",
  recommendation,
  rationale: "Coverage drops below the cushion.",
  guardReasons: [],
});

describe("LeaveDecisionProposalCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    approveLeaveRequest.mockResolvedValue({ success: true });
    rejectLeaveRequest.mockResolvedValue({ success: true });
  });
  afterEach(cleanup);

  it("shows the recommendation and explicit leave verbs", () => {
    render(<LeaveDecisionProposalCard status="proposed" parameters={params("deny")} />);
    expect(screen.getByText(/Advisor recommends/)).toBeTruthy();
    expect(screen.getByText("deny")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve leave" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deny leave" })).toBeTruthy();
  });

  it("Approve leave on a deny recommendation approves the leave — the manager's call, stated explicitly", async () => {
    render(<LeaveDecisionProposalCard status="proposed" parameters={params("deny")} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve leave" }));
    await waitFor(() => expect(approveLeaveRequest).toHaveBeenCalledWith("LR-1"));
    expect(rejectLeaveRequest).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Leave approved");
  });

  it("Deny leave asks for the reason and denies through the governed action", async () => {
    promptDialog.mockResolvedValue("Peak week");
    render(<LeaveDecisionProposalCard status="proposed" parameters={params("approve")} />);
    fireEvent.click(screen.getByRole("button", { name: "Deny leave" }));
    await waitFor(() => expect(rejectLeaveRequest).toHaveBeenCalledWith("LR-1", "Peak week"));
    expect(approveLeaveRequest).not.toHaveBeenCalled();
  });

  it("Deny leave cancelled at the reason prompt decides nothing", async () => {
    promptDialog.mockResolvedValue(null);
    render(<LeaveDecisionProposalCard status="proposed" parameters={params("deny")} />);
    fireEvent.click(screen.getByRole("button", { name: "Deny leave" }));
    await waitFor(() => expect(promptDialog).toHaveBeenCalled());
    expect(rejectLeaveRequest).not.toHaveBeenCalled();
    expect(approveLeaveRequest).not.toHaveBeenCalled();
  });

  it("surfaces a refusal from the leave action", async () => {
    approveLeaveRequest.mockResolvedValue({ success: false, error: "Request already decided" });
    render(<LeaveDecisionProposalCard status="proposed" parameters={params("approve")} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve leave" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Request already decided");
  });

  it("shows the settled leave outcome with no buttons once decided", () => {
    render(<LeaveDecisionProposalCard status="rejected" parameters={params("approve")} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Leave denied");
  });
});

describe("AgentMessageBubble on a leave.decide proposal", () => {
  afterEach(cleanup);

  it("renders the explicit leave card instead of the generic Approve / Reject verbs", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(
      <AgentMessageBubble
        message={{
          id: "m1",
          role: "assistant",
          content: "Time-off recommendation: deny. Coverage drops below the cushion.",
          createdAt: new Date("2026-10-07T00:00:00.000Z").toISOString(),
          agentId: "time-off-advisor",
          proposal: {
            proposalId: "AP-LEAVE",
            actionType: "leave.decide",
            parameters: params("deny"),
            status: "proposed",
          },
        } as never}
        showAgentLabel={false}
        agentName={null}
        onApprove={onApprove}
        onReject={onReject}
      />,
    );
    expect(screen.getByRole("button", { name: "Approve leave" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deny leave" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });
});
