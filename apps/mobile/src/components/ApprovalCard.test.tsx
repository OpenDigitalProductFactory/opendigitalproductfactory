import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { ApprovalCard } from "./ApprovalCard";

describe("ApprovalCard", () => {
  const fakeApproval = {
    id: "prop-1",
    proposalId: "PROP-001",
    threadId: "thread-1",
    messageId: "msg-1",
    agentId: "ops-coordinator",
    actionType: "create-backlog-item",
    parameters: { title: "New feature", type: "product" },
    status: "proposed",
    proposedAt: "2026-03-19T00:00:00Z",
    decidedAt: null,
    decidedById: null,
    executedAt: null,
    resultEntityId: null,
    resultError: null,
    gitCommitHash: null,
  } as any;

  const mockDecide = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders action type", async () => {
    const { getByText } = await render(
      <ApprovalCard approval={fakeApproval} onDecide={mockDecide} />,
    );
    expect(getByText("create-backlog-item")).toBeTruthy();
  });

  it("renders parameter summary", async () => {
    const { getByText } = await render(
      <ApprovalCard approval={fakeApproval} onDecide={mockDecide} />,
    );
    expect(getByText(/title: New feature/)).toBeTruthy();
  });

  it("renders agent name", async () => {
    const { getByText } = await render(
      <ApprovalCard approval={fakeApproval} onDecide={mockDecide} />,
    );
    expect(getByText("Agent: ops-coordinator")).toBeTruthy();
  });

  it("calls onDecide with approve when Approve pressed", async () => {
    const { getByText } = await render(
      <ApprovalCard approval={fakeApproval} onDecide={mockDecide} />,
    );
    await fireEvent.press(getByText("Approve"));
    expect(mockDecide).toHaveBeenCalledWith("prop-1", "approve", undefined);
  });

  it("calls onDecide with reject when Reject pressed", async () => {
    const { getByText } = await render(
      <ApprovalCard approval={fakeApproval} onDecide={mockDecide} />,
    );
    await fireEvent.press(getByText("Reject"));
    expect(mockDecide).toHaveBeenCalledWith("prop-1", "reject", undefined);
  });

  it("passes rationale when provided", async () => {
    const { getByText, getByLabelText } = await render(
      <ApprovalCard approval={fakeApproval} onDecide={mockDecide} />,
    );
    await fireEvent.changeText(getByLabelText("Rationale"), "Looks good to me");
    await fireEvent.press(getByText("Approve"));
    expect(mockDecide).toHaveBeenCalledWith(
      "prop-1",
      "approve",
      "Looks good to me",
    );
  });
});
