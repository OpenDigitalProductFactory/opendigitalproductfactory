import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// BI-D77BF495: SelfUpgradeTriggerControl was extracted from SelfUpgradeClient so
// the trigger could be co-located with the OwnerReleaseCard release-status
// summary instead of buried behind the Advanced disclosure. These tests were
// migrated out of SelfUpgradeClient.test.tsx's "trigger control" / "loading
// state" / "success feedback" / "error feedback" / "disabled" describe blocks —
// same behavior, new home.
const shared = vi.hoisted(() => ({
  isPending: false,
  triggerResult: null as { queued: boolean; reason?: string } | null,
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useTransition: () => [shared.isPending, vi.fn()] as const,
    useState: <T,>(initial: T) => {
      if (initial === null) {
        return [shared.triggerResult as T, vi.fn()] as const;
      }
      if (typeof initial === "function") {
        return [initial(), vi.fn()] as const;
      }
      return [initial, vi.fn()] as const;
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/promotions", () => ({
  triggerSelfUpgrade: vi.fn(),
  forceActiveRun: vi.fn(),
  abortActiveRun: vi.fn(),
}));

import SelfUpgradeTriggerControl from "./SelfUpgradeTriggerControl";

const baseProps = {
  enabled: true,
  actionState: "update-available" as const,
  channel: "stable",
  latestRun: null,
};

function makeRun(status: string, overrides: Record<string, unknown> = {}) {
  return {
    runId: "SUR-0001",
    status,
    trigger: "scheduled",
    currentSha: "abc1234",
    targetSha: "def5678",
    deployedSha: "def5678",
    reason: null as string | null,
    startedAt: new Date("2026-05-20T02:00:00Z"),
    completedAt: new Date("2026-05-20T02:05:00Z"),
    completionEvidence: null,
    failureLog: null as string | null,
    createdAt: new Date("2026-05-20T02:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  shared.isPending = false;
  shared.triggerResult = null;
});

// ─── Disabled ─────────────────────────────────────────────────────────────────

describe("SelfUpgradeTriggerControl – disabled", () => {
  it("shows an explicit unavailable notice for consumer releases", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeTriggerControl
        {...baseProps}
        enabled={false}
        unavailableReason="Automatic updates aren’t available for this install yet."
      />,
    );
    expect(html).toContain("Automatic updates aren’t available for this install yet.");
    expect(html).not.toContain("Enable it in settings");
    expect(html).toContain('data-upgrade-status="unavailable"');
  });

  it("does not render the Upgrade now button when disabled", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeTriggerControl {...baseProps} enabled={false} />,
    );
    expect(html).not.toContain("Upgrade now");
  });

  it("shows the disabled notice copy", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeTriggerControl {...baseProps} enabled={false} />,
    );
    expect(html).toContain("Self-upgrade is disabled");
  });
});

// ─── Enabled ──────────────────────────────────────────────────────────────────

describe("SelfUpgradeTriggerControl – enabled", () => {
  it("shows Enabled label with channel", () => {
    const html = renderToStaticMarkup(<SelfUpgradeTriggerControl {...baseProps} />);
    expect(html).toContain("Enabled");
    expect(html).toContain("stable");
  });

  it("does not expose upgrade or emergency controls when the install is current", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeTriggerControl {...baseProps} actionState="no-update" />,
    );
    expect(html).toContain("No update is ready");
    expect(html).not.toContain('aria-label="Upgrade now"');
    expect(html).not.toContain("Emergency override");
  });

  it("does not expose a mutation when update availability could not be verified", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeTriggerControl {...baseProps} actionState="unavailable" />,
    );
    expect(html).toContain("Update status unavailable");
    expect(html).not.toContain('aria-label="Upgrade now"');
    expect(html).not.toContain("Emergency override");
    expect(html).not.toContain("Upgrade queued.");
  });

  it("renders the Upgrade now button, marked as the primary / next action (BI-D77BF495)", () => {
    const html = renderToStaticMarkup(<SelfUpgradeTriggerControl {...baseProps} />);
    expect(html).toContain("Upgrade now");
    // The UX budget reachability axis keys off these markers.
    expect(html).toContain("data-dpf-primary-action");
    expect(html).toContain("data-owner-first-next-action");
  });

  it("renders solid primary-button styling, not a faint text-xs ghost button (BI-D77BF495)", () => {
    const html = renderToStaticMarkup(<SelfUpgradeTriggerControl {...baseProps} />);
    expect(html).toMatch(/aria-label="Upgrade now"[^>]*class="[^"]*bg-\[var\(--dpf-accent\)\][^"]*text-white/);
  });
});

// ─── Running ──────────────────────────────────────────────────────────────────

describe("SelfUpgradeTriggerControl – running", () => {
  it("shows queued state as accepted work instead of an idle trigger", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeTriggerControl
        {...baseProps}
        latestRun={makeRun("queued", { startedAt: null, completedAt: null })}
      />,
    );
    expect(html).toContain("Upgrade queued");
    expect(html).toContain("waiting for the worker");
    expect(html).not.toContain('aria-label="Upgrade now"');
  });

  it("shows an in-flight indicator (not a disabled trigger) when a run is running", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeTriggerControl {...baseProps} latestRun={makeRun("running")} />,
    );
    expect(html).toContain("Upgrade in progress…");
    expect(html).not.toContain('aria-label="Upgrade now"');
  });

  it.each([
    ["admission_pending", "waiting for dispatch"],
    ["dispatching", "dispatching to the worker"],
    ["indeterminate", "dispatch outcome is being reconciled"],
  ])("projects durable %s state with the admitted run identity", (dispatchStatus, copy) => {
    const html = renderToStaticMarkup(
      <SelfUpgradeTriggerControl
        {...baseProps}
        latestRun={makeRun("pending", { dispatchStatus, startedAt: null, completedAt: null })}
      />,
    );
    expect(html).toContain("SUR-0001 admitted");
    expect(html).toContain(copy);
    expect(html).not.toContain('aria-label="Upgrade now"');
  });

  it("projects a durable pre-dispatch failure with its run identity", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeTriggerControl
        {...baseProps}
        latestRun={makeRun("failed", {
          dispatchStatus: "dispatch_failed",
          dispatchError: "queue-dispatch-refused",
        })}
      />,
    );
    expect(html).toContain("SUR-0001 was not dispatched");
    expect(html).toContain("queue-dispatch-refused");
  });

  it("surfaces Force now / Abort controls when the portal is draining (BI-4F3B2FA9)", () => {
    const quiescence = {
      level: "draining" as const,
      runId: "QR-2026-06-10-test",
      enteredAt: "2026-06-10T02:00:00.000Z",
      run: {
        runId: "QR-2026-06-10-test",
        status: "draining",
        trigger: "self-upgrade",
        targetVersion: null,
        targetBundleHash: null,
        deferSurface: null,
        deferReason: null,
        budgetMs: 300000,
        drainStartedAt: "2026-06-10T02:00:00.000Z",
        lastHeartbeatAt: null,
      },
      blockersCapturedAt: null,
      blockers: [],
    };
    const html = renderToStaticMarkup(
      <SelfUpgradeTriggerControl
        {...baseProps}
        latestRun={makeRun("running")}
        quiescence={quiescence}
      />,
    );
    expect(html).toContain("Force now");
    expect(html).toContain("Abort");
    expect(html).toContain("Force upgrade run QR-2026-06-10-test now");
  });
});

// ─── Trigger control basics ────────────────────────────────────────────────────

describe("SelfUpgradeTriggerControl – trigger control", () => {
  it("button has type=button attribute", () => {
    const html = renderToStaticMarkup(<SelfUpgradeTriggerControl {...baseProps} />);
    expect(html).toContain('type="button"');
  });

  it("button is not disabled when no run is active", () => {
    const html = renderToStaticMarkup(<SelfUpgradeTriggerControl {...baseProps} />);
    expect(html).toContain("Upgrade now");
    expect(html).not.toContain('disabled=""');
  });
});

// ─── Loading state ────────────────────────────────────────────────────────────

describe("SelfUpgradeTriggerControl – loading", () => {
  it("shows durable admission text when pending", () => {
    shared.isPending = true;
    const html = renderToStaticMarkup(<SelfUpgradeTriggerControl {...baseProps} />);
    expect(html).toContain("Admitting…");
    expect(html).not.toContain(">Upgrade now<");
  });

  it("button is disabled while pending", () => {
    shared.isPending = true;
    const html = renderToStaticMarkup(<SelfUpgradeTriggerControl {...baseProps} />);
    expect(html).toContain('disabled=""');
  });

  it("button has aria-busy=true while pending", () => {
    shared.isPending = true;
    const html = renderToStaticMarkup(<SelfUpgradeTriggerControl {...baseProps} />);
    expect(html).toContain('aria-busy="true"');
  });

  it("shows the 'starting' hint while busy and no run is running yet", () => {
    shared.isPending = true;
    const html = renderToStaticMarkup(<SelfUpgradeTriggerControl {...baseProps} />);
    expect(html).toContain('data-upgrade-starting="true"');
    expect(html).toContain("durable run will appear");
  });

  it("does not show the 'starting' hint once a run is already running", () => {
    shared.isPending = false;
    const html = renderToStaticMarkup(
      <SelfUpgradeTriggerControl {...baseProps} latestRun={makeRun("running")} />,
    );
    expect(html).not.toContain('data-upgrade-starting="true"');
  });
});

// ─── Success feedback ─────────────────────────────────────────────────────────

describe("SelfUpgradeTriggerControl – success feedback", () => {
  it("shows durable admission feedback when trigger succeeds", () => {
    shared.triggerResult = { queued: true };
    const html = renderToStaticMarkup(<SelfUpgradeTriggerControl {...baseProps} />);
    expect(html).toContain("Upgrade admitted");
  });
});

// ─── Error feedback ───────────────────────────────────────────────────────────

describe("SelfUpgradeTriggerControl – error feedback", () => {
  it("shows Not admitted when the durable request is refused", () => {
    shared.triggerResult = { queued: false, reason: "disabled" };
    const html = renderToStaticMarkup(<SelfUpgradeTriggerControl {...baseProps} />);
    expect(html).toContain("Not admitted:");
  });

  it("shows the specific reason for not queuing", () => {
    shared.triggerResult = { queued: false, reason: "already-running" };
    const html = renderToStaticMarkup(<SelfUpgradeTriggerControl {...baseProps} />);
    expect(html).toContain("already-running");
  });
});
