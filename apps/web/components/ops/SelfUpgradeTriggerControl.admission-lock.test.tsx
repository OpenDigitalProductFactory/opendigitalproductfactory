// @vitest-environment jsdom
//
// BI-CE244260: after a successful admission the "Upgrade now" button came back
// and the only thing standing between the operator and a second trigger was
// the sentence "do not click again". A warning is not a control. The button
// now stays out of reach from admission until the admitted run is visible and
// terminal — and comes back then, because a run that was skipped or failed is
// exactly when a retry is right.
import "@/test-setup";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/promotions", () => ({
  triggerSelfUpgrade: vi.fn(),
  forceActiveRun: vi.fn(),
  abortActiveRun: vi.fn(),
}));

import { triggerSelfUpgrade } from "@/lib/actions/promotions";
import SelfUpgradeTriggerControl from "./SelfUpgradeTriggerControl";

const triggerMock = triggerSelfUpgrade as unknown as ReturnType<typeof vi.fn>;

function run(runId: string, status: string) {
  return {
    runId,
    status,
    trigger: "manual",
    currentSha: "abc1234",
    targetSha: "def5678",
    deployedSha: status === "succeeded" ? "def5678" : null,
    reason: null,
    startedAt: new Date("2026-09-25T19:57:00Z"),
    completedAt: status === "queued" || status === "running" ? null : new Date("2026-09-25T19:57:01Z"),
    completionEvidence: null,
    failureLog: null,
    createdAt: new Date("2026-09-25T19:57:00Z"),
  };
}

const props = {
  enabled: true,
  actionState: "update-available" as const,
  channel: "stable",
  latestRun: run("SUR-PREVIOUS", "succeeded"),
};

describe("SelfUpgradeTriggerControl — an admitted upgrade cannot be triggered twice (BI-CE244260)", () => {
  beforeEach(() => triggerMock.mockReset());

  it("removes Upgrade now once admitted, before the run is visible, with no do-not-click prose", async () => {
    triggerMock.mockResolvedValue({ queued: true, admitted: true, runId: "SUR-57A296FA" });
    render(<SelfUpgradeTriggerControl {...props} />);

    fireEvent.click(screen.getByRole("button", { name: /upgrade now/i }));

    await waitFor(() => expect(screen.getByText(/SUR-57A296FA/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /upgrade now/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/do not click again/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/keep this page open/i)).not.toBeInTheDocument();
  });

  it("stays locked while the admitted run is queued or running", async () => {
    triggerMock.mockResolvedValue({ queued: true, admitted: true, runId: "SUR-57A296FA" });
    const { rerender } = render(<SelfUpgradeTriggerControl {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /upgrade now/i }));
    await waitFor(() => expect(screen.getByText(/SUR-57A296FA/)).toBeInTheDocument());

    rerender(<SelfUpgradeTriggerControl {...props} latestRun={run("SUR-57A296FA", "running")} />);
    expect(screen.queryByRole("button", { name: /upgrade now/i })).not.toBeInTheDocument();
  });

  it("gives the button back once the admitted run settles, so a skipped run can be retried", async () => {
    triggerMock.mockResolvedValue({ queued: true, admitted: true, runId: "SUR-57A296FA" });
    const { rerender } = render(<SelfUpgradeTriggerControl {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /upgrade now/i }));
    await waitFor(() => expect(screen.getByText(/SUR-57A296FA/)).toBeInTheDocument());

    rerender(<SelfUpgradeTriggerControl {...props} latestRun={run("SUR-57A296FA", "skipped")} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /upgrade now/i })).toBeEnabled());
  });

  it("a refused admission leaves the button available with the reason", async () => {
    triggerMock.mockResolvedValue({ queued: false, reason: "already-running", runId: "SUR-OTHER" });
    render(<SelfUpgradeTriggerControl {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /upgrade now/i }));
    await waitFor(() => expect(screen.getByText(/Not admitted: already-running/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /upgrade now/i })).toBeEnabled();
  });
});
