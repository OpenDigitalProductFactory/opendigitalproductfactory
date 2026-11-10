// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refreshRoute: vi.fn(),
  refreshStatus: vi.fn().mockResolvedValue(undefined),
  trigger: vi.fn().mockResolvedValue({ queued: true }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refreshRoute }),
}));

vi.mock("@/lib/actions/promotions", () => ({
  triggerSelfUpgrade: mocks.trigger,
  forceActiveRun: vi.fn(),
  abortActiveRun: vi.fn(),
}));

vi.mock("@/components/ops/SelfUpgradeLiveProvider", () => ({
  useOptionalSelfUpgradeLive: () => ({
    snapshot: {
      latestRun: null,
      quiescence: {
        level: "normal",
        runId: null,
        enteredAt: "2026-08-01T00:00:00.000Z",
        run: null,
        blockersCapturedAt: null,
        blockers: [],
      },
      jobEngine: {
        status: "healthy",
        detail: null,
        checkedAt: null,
        watchdog: {
          status: "healthy",
          detail: null,
          lastInvocationAt: null,
          lastGatewayHitAt: null,
          lastRecoveryAttemptAt: null,
          lastRecoverySummary: null,
        },
      },
    },
    refresh: mocks.refreshStatus,
    pending: false,
    error: null,
  }),
}));

import SelfUpgradeTriggerControl from "./SelfUpgradeTriggerControl";

describe("SelfUpgradeTriggerControl live observation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rehydrates the targeted status after enqueue without refreshing the route", async () => {
    render(
      <SelfUpgradeTriggerControl
        enabled
        actionState="update-available"
        channel="stable"
        latestRun={null}
        targetBinding="server-signed-target"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Upgrade now" }));

    await waitFor(() => expect(mocks.trigger).toHaveBeenCalledOnce());
    expect(mocks.trigger).toHaveBeenCalledWith({ targetBinding: "server-signed-target" });
    await waitFor(() => expect(mocks.refreshStatus).toHaveBeenCalledOnce());
    expect(mocks.refreshRoute).not.toHaveBeenCalled();
  });
});
