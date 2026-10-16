// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ReviewerExecutionList } from "./ReviewerExecutionList";
import type { ReviewerExecutionObservation } from "@/lib/work-management/semantic-review-room-projection";
import { loadSemanticReviewRoomProjection } from "@/lib/work-management/semantic-review-room-projection";
vi.mock("@/components/platform/StalledTaskRecoveryActions", () => ({
  StalledTaskRecoveryActions: ({ taskRunId, reviewBudget }: { taskRunId: string; reviewBudget: unknown }) =>
    <div data-testid="recovery">{taskRunId} {JSON.stringify(reviewBudget)}</div>,
}));
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-21T07:00:00Z")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const run: ReviewerExecutionObservation = {
  taskRunId: "TR-1", recordId: "row-1", status: "input-required", requesterId: "requester-1",
  reason: "provider-outcome-uncertain-after-restart", nextAction: "Inspect provider evidence.",
  readAt: "2026-09-21T07:00:00Z", lastHeartbeatAt: null, heartbeat: "unknown", recoveryWait: true,
  budget: { deadlineAt: "2026-09-21T07:30:00Z", recoveryAttempt: 1 },
  checkpoints: [{ taskNodeId: "TN-1", recordId: "node-1", title: "Architecture review", status: "completed", actorId: "AGT-181" }],
};
describe("reviewer execution inside a Workroom", () => {
  it("renders a readable automatic capacity wait without offering duplicate manual recovery", async () => {
    const now = new Date("2026-09-21T07:00:00Z");
    const view = await loadSemanticReviewRoomProjection({
      taskRun: { findMany: async () => [{ id: "row-1", taskRunId: "TR-1", userId: "requester-1",
        status: "input-required", updatedAt: now, lastHeartbeatAt: null, nodes: [],
        progressPayload: { semanticReview: { schemaVersion: 1, requestDigest: "a".repeat(64), reason: "review-capacity-deferred",
          capacityWaitReason: "host-gpu-busy", nextAction: "retry-review", deadlineAt: "2026-09-21T07:30:00Z", recoveryAttempt: 1,
          capacityRecovery: { schemaVersion: 1, requestDigest: "a".repeat(64), checks: 0, nextCheckAt: "2026-09-21T07:00:30Z" } } } }] },
      $queryRaw: vi.fn().mockResolvedValue([{ rowId: "row-1", capsuleId: "WC-1", requestBound: true,
        requestSchemaVersion: 2, requestArtifactType: "code-change", identityArtifactType: "code-change", identityArtifactTypePresent: true,
        sourceHeadSha: "a".repeat(40), currentHeadSha: "a".repeat(40), issuedAt: "2026-09-21T06:50:00Z" }]),
    }, ["WC-1"], now);
    render(<ReviewerExecutionList runs={view.runs} />);
    expect(screen.getByText("Review is waiting for the graphics processor to become available.")).toBeInTheDocument();
    expect(screen.getByText(/server will recheck capacity/)).toBeInTheDocument();
    expect(screen.queryByTestId("recovery")).not.toBeInTheDocument();
    expect(screen.queryByText(/Recorded reason: host-gpu-busy/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request history" })).toHaveAttribute("href", "/api/internal/tasks/TR-1");
  });

  it("shows the correlated receipt's verdict and summary without claiming the room is complete", () => {
    render(<ReviewerExecutionList runs={[{ ...run, receipt: { id: "receipt-1", decision: "inconclusive", summary: "A required branch could not finish." } }]} />);
    expect(screen.getByText(/A required branch could not finish/)).toBeInTheDocument();
    expect(screen.getByText(/receipt-1/)).toBeInTheDocument();
    expect(screen.getByText(/does not verify the Workroom outcome/)).toBeInTheDocument();
  });
  it("retains historical request evidence without offering recovery for an older change", () => {
    render(<ReviewerExecutionList runs={[{ ...run, identityScope: "historical", sourceHeadSha: "a".repeat(40) }]} />);
    expect(screen.getByText(/Historical request/)).toBeInTheDocument();
    expect(screen.queryByTestId("recovery")).not.toBeInTheDocument();
    expect(screen.getByText(/Inspect the current request/)).toBeInTheDocument();
    expect(screen.getByText(/aaaaaaaa/)).toBeInTheDocument();
  });
  it("does not advertise a recorded retry after the request deadline", () => {
    render(<ReviewerExecutionList runs={[{ ...run, nextAction: "retry-review",
      budget: { deadlineAt: "2026-09-21T06:59:00Z", recoveryAttempt: 0 } }]} />);
    expect(screen.getByText(/This request cannot resume/)).toBeInTheDocument();
    expect(screen.queryByText("retry-review")).not.toBeInTheDocument();
  });
  it("updates the next action when the deadline passes without a reload", () => {
    render(<ReviewerExecutionList runs={[{ ...run, nextAction: "retry-review",
      budget: { deadlineAt: "2026-09-21T07:00:01Z", recoveryAttempt: 0 } }]} />);
    expect(screen.getByText(/original requester can confirm recovery/)).toBeInTheDocument();
    expect(screen.getByText(/original requester can confirm recovery/)).toHaveAttribute("aria-live", "polite");
    act(() => vi.advanceTimersByTime(1001));
    expect(screen.getByText(/This request cannot resume/)).toBeInTheDocument();
  });
  it.each([3, null])("does not offer retry when the counter is exhausted or unknown (%s)", recoveryAttempt => {
    render(<ReviewerExecutionList runs={[{ ...run, nextAction: "retry-review", budget: { ...run.budget, recoveryAttempt } }]} />);
    expect(screen.queryByText("retry-review")).not.toBeInTheDocument();
    expect(screen.getByText(/cannot resume|limits could not be read/)).toBeInTheDocument();
  });
  it("answers the six questions with recorded identity and shared recovery limits", () => {
    render(<ReviewerExecutionList runs={[run]} />);
    for (const question of ["Where are we?", "Why are we here?", "What can happen next?", "Who owns the action?", "What evidence supports this?", "What else is affected?"]) {
      expect(screen.getByText(question)).toBeInTheDocument();
    }
    expect(screen.getByText("Execution restarted before a provider outcome was recorded.")).toBeInTheDocument();
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
  it("uses the recorded display name and deduplicates repeated failure reasons", () => {
    render(<ReviewerExecutionList runs={[{ ...run, requesterName: "Alex", reason: "unparseable-review-response,unparseable-review-response" }]} />);
    expect(screen.getByText(/Requester: Alex/)).toBeInTheDocument();
    expect(screen.getAllByText("The reviewer response could not be validated. No review verdict was accepted.")).toHaveLength(1);
  });
});
