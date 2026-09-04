// @vitest-environment jsdom
//
// Regression coverage for the forced-self-upgrade crash, migrated (BI-D77BF495)
// from SelfUpgradeClient.swap-resilience.test.tsx now that the trigger/force/
// abort actions live in SelfUpgradeTriggerControl: a forced upgrade bypasses
// the quiescence drain and swaps the portal out from under the operator's own
// request, so the server-action response comes back as a non-RSC transport
// failure (Next error code E394, "An unexpected response was received from the
// server"). The handlers must recognise the expected mid-swap disconnect and
// hold a calm "reconnecting" state instead of escalating to the (shell) error
// boundary.
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

import { triggerSelfUpgrade, forceActiveRun } from "@/lib/actions/promotions";
import SelfUpgradeTriggerControl from "./SelfUpgradeTriggerControl";
import { isExpectedDuringSwap } from "@/lib/self-upgrade/is-expected-during-swap";

const triggerMock = triggerSelfUpgrade as unknown as ReturnType<typeof vi.fn>;
const forceMock = forceActiveRun as unknown as ReturnType<typeof vi.fn>;

// The real Next.js E394 transport error: a generic message plus a stable,
// non-enumerable error code stamped by the server-action reducer.
function makeE394(): Error {
  const e = new Error("An unexpected response was received from the server.");
  Object.defineProperty(e, "__NEXT_ERROR_CODE", {
    value: "E394",
    enumerable: false,
  });
  return e;
}

const baseProps = {
  enabled: true,
  actionState: "update-available" as const,
  channel: "stable",
  latestRun: null,
} as const;

function makeRun(status: string, overrides: Record<string, unknown> = {}) {
  return {
    runId: "SUR-0001",
    status,
    trigger: "manual",
    currentSha: "abc1234",
    targetSha: "def5678",
    deployedSha: "def5678",
    reason: null as string | null,
    startedAt: new Date("2026-06-18T02:00:00Z"),
    completedAt: null,
    completionEvidence: null,
    failureLog: null as string | null,
    createdAt: new Date("2026-06-18T02:00:00Z"),
    ...overrides,
  };
}

const drainingQuiescence = {
  level: "draining" as const,
  runId: "QR-DRAIN",
  enteredAt: "2026-06-18T01:44:00.000Z",
  run: {
    runId: "QR-DRAIN",
    status: "draining",
    trigger: "self-upgrade",
    targetVersion: "abcdef0123456789",
    targetBundleHash: "abcdef0123456789",
    deferSurface: null,
    deferReason: null,
    budgetMs: 300000,
    drainStartedAt: "2026-06-18T01:44:00.000Z",
    lastHeartbeatAt: "2026-06-18T01:44:30.000Z",
  },
  blockersCapturedAt: null,
  blockers: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── isExpectedDuringSwap (pure) ───────────────────────────────────────────

describe("isExpectedDuringSwap", () => {
  it("detects the Next E394 transport error by code", () => {
    expect(isExpectedDuringSwap(makeE394())).toBe(true);
  });

  it("detects the transport error by message when no code is present", () => {
    expect(
      isExpectedDuringSwap(
        new Error("An unexpected response was received from the server."),
      ),
    ).toBe(true);
  });

  it("detects bare network failures from a severed connection", () => {
    expect(isExpectedDuringSwap(new TypeError("Failed to fetch"))).toBe(true);
    expect(
      isExpectedDuringSwap(new Error("NetworkError when attempting to fetch resource")),
    ).toBe(true);
    expect(isExpectedDuringSwap(new Error("connection reset"))).toBe(true);
  });

  it("does not match ordinary application errors", () => {
    expect(isExpectedDuringSwap(new Error("Unauthorized"))).toBe(false);
    expect(isExpectedDuringSwap(new Error("disabled"))).toBe(false);
    expect(isExpectedDuringSwap(null)).toBe(false);
    expect(isExpectedDuringSwap(undefined)).toBe(false);
  });
});

// ─── Forced trigger severed by the swap ────────────────────────────────────

describe("SelfUpgradeTriggerControl – forced upgrade swap resilience", () => {
  it("keeps an interrupted trigger admission latched until durable server state changes", async () => {
    triggerMock.mockRejectedValue(makeE394());

    render(<SelfUpgradeTriggerControl {...baseProps} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /emergency override/i }));
    fireEvent.click(screen.getByRole("button", { name: /upgrade now/i }));

    await waitFor(() => {
      expect(screen.getByText(/Admission response interrupted:/i)).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /upgrade now/i })).toBeDisabled();
    expect(screen.getByText(/do not click again/i)).toBeInTheDocument();
    expect(screen.queryByText(/Not admitted:/i)).not.toBeInTheDocument();
  });

  it("treats every thrown trigger response as indeterminate because admission may already be durable", async () => {
    triggerMock.mockRejectedValue(new Error("Unauthorized"));

    render(<SelfUpgradeTriggerControl {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: /upgrade now/i }));

    await waitFor(() => {
      expect(screen.getByText(/Admission response interrupted:/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Unauthorized/i)).toBeInTheDocument();
    expect(screen.queryByText(/Applying the upgrade/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upgrade now/i })).toBeDisabled();
  });

  it("treats a severed Force-now request during a drain as applying, not a crash", async () => {
    forceMock.mockRejectedValue(new TypeError("Failed to fetch"));

    render(
      <SelfUpgradeTriggerControl
        {...baseProps}
        latestRun={makeRun("running")}
        quiescence={drainingQuiescence}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Force upgrade run QR-DRAIN now/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /confirm force/i }));

    await waitFor(() => {
      expect(screen.getByText(/Applying the upgrade/i)).toBeInTheDocument();
    });
  });

  it("clears the indeterminate admission latch once a durable run appears", async () => {
    triggerMock.mockRejectedValue(makeE394());

    const { rerender } = render(<SelfUpgradeTriggerControl {...baseProps} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /emergency override/i }));
    fireEvent.click(screen.getByRole("button", { name: /upgrade now/i }));

    await waitFor(() => {
      expect(screen.getByText(/Admission response interrupted:/i)).toBeInTheDocument();
    });

    // The poll reaches the new container: a fresh run is now visible.
    rerender(
      <SelfUpgradeTriggerControl
        {...baseProps}
        latestRun={makeRun("succeeded", {
          completedAt: new Date("2026-06-18T02:05:00Z"),
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText(/Admission response interrupted:/i)).not.toBeInTheDocument();
    });
  });

  it("keeps a normal queued trigger working (no false reconnecting state)", async () => {
    triggerMock.mockResolvedValue({ queued: true, runId: "SUR-9999" });

    render(<SelfUpgradeTriggerControl {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: /upgrade now/i }));

    await waitFor(() => {
      expect(triggerMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(/Applying the upgrade/i)).not.toBeInTheDocument();
  });
});
