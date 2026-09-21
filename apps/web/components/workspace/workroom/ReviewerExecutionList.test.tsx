// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ReviewerExecutionList } from "./ReviewerExecutionList";
import type { ReviewerExecutionObservation } from "@/lib/work-management/semantic-review-room-projection";
vi.mock("@/components/platform/StalledTaskRecoveryActions", () => ({
  StalledTaskRecoveryActions: ({ taskRunId, reviewBudget }: { taskRunId: string; reviewBudget: unknown }) =>
    <div data-testid="recovery">{taskRunId} {JSON.stringify(reviewBudget)}</div>,
}));
afterEach(cleanup);
const run: ReviewerExecutionObservation = {
  taskRunId: "TR-1", recordId: "row-1", status: "input-required", requesterId: "requester-1",
  reason: "provider-outcome-uncertain-after-restart", nextAction: "Inspect provider evidence.",
  readAt: "2026-09-21T07:00:00Z", lastHeartbeatAt: null, heartbeat: "unknown", recoveryWait: true,
  budget: { deadlineAt: "2026-09-21T07:30:00Z", recoveryAttempt: 1 },
  checkpoints: [{ taskNodeId: "TN-1", recordId: "node-1", title: "Architecture review", status: "completed", actorId: "AGT-181" }],
};
describe("reviewer execution inside a Workroom", () => {
  it("answers the six questions with recorded identity and shared recovery limits", () => {
    render(<ReviewerExecutionList runs={[run]} />);
    for (const question of ["Where are we?", "Why are we here?", "What can happen next?", "Who owns the action?", "What evidence supports this?", "What else is affected?"]) {
      expect(screen.getByText(question)).toBeInTheDocument();
    }
    expect(screen.getByText(run.reason!)).toBeInTheDocument();
    expect(screen.getByText(/requester-1/)).toBeInTheDocument();
    expect(screen.getByTestId("recovery")).toHaveTextContent('"recoveryAttempt":1');
    expect(screen.getByRole("link", { name: "Request history" })).toHaveAttribute("href", "/api/internal/tasks/TR-1");
    expect(screen.getByText(/Checkpoint status is not a verified verdict/)).toBeInTheDocument();
  });
  it("keeps terminal observations historical without offering recovery or claiming completion", () => {
    render(<ReviewerExecutionList runs={[{ ...run, status: "completed", recoveryWait: false, heartbeat: "historical" }]} />);
    expect(screen.queryByTestId("recovery")).not.toBeInTheDocument();
    expect(screen.getByText(/historical/)).toBeInTheDocument();
    expect(screen.getByText(/does not verify the Workroom outcome/)).toBeInTheDocument();
  });
});
