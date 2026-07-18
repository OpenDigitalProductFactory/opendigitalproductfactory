import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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
        // Handle lazy initializers (useState(() => ...)) so we don't return the initializer fn
        // as state value (which can cause "Functions are not valid as a React child" when rendered).
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
  rollbackSelfUpgrade: vi.fn(),
}));

// The global useState mock above keys off `initial === null`, so any child
// component with its own `useState<X | null>(null)` would otherwise receive
// `shared.triggerResult` and try to render it. Stub the impact panel so the
// trigger-control tests stay focused on this component's behavior.
vi.mock("@/components/ops/UpgradeImpactPanel", () => ({
  default: () => null,
}));

import SelfUpgradeClient, { conciseFailureReason } from "./SelfUpgradeClient";

const baseStatus = {
  enabled: true,
  channel: "stable",
  inMaintenanceWindow: false,
  nextScheduledCheckAt: "2026-05-24T18:00:00.000Z",
  deployedSha: "abc1234",
  targetSha: "def5678",
  isFresh: false,
  latestRun: null,
  platformVersion: {
    version: "1.0.0",
    publishedAt: "2026-05-24T00:00:00.000Z",
    gitSha: "9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1098",
    note: "baseline",
  },
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

describe("SelfUpgradeClient – disabled", () => {
  it("shows Disabled label when self-upgrade is off", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} enabled={false} />,
    );
    expect(html).toContain("Disabled");
  });

  it("does not render the Upgrade now button when disabled", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} enabled={false} />,
    );
    expect(html).not.toContain("Upgrade now");
  });

  it("shows the disabled notice copy", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} enabled={false} />,
    );
    expect(html).toContain("Self-upgrade is disabled");
  });
});

// ─── Enabled ──────────────────────────────────────────────────────────────────

describe("SelfUpgradeClient – enabled", () => {
  it("shows Enabled label with channel", () => {
    const html = renderToStaticMarkup(<SelfUpgradeClient {...baseStatus} />);
    expect(html).toContain("Enabled");
    expect(html).toContain("stable");
  });

  it("renders the Upgrade now button when enabled", () => {
    const html = renderToStaticMarkup(<SelfUpgradeClient {...baseStatus} />);
    expect(html).toContain("Upgrade now");
  });

  it("shows the deployed and target SHA values", () => {
    const html = renderToStaticMarkup(<SelfUpgradeClient {...baseStatus} />);
    expect(html).toContain("abc1234");
    expect(html).toContain("def5678");
  });

  it("shows update-available label when not fresh", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} isFresh={false} />,
    );
    expect(html).toContain("Update available");
  });

  it("shows up-to-date label when isFresh is true", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} isFresh={true} targetSha="abc1234" deployedSha="abc1234" />,
    );
    expect(html).toContain("Up to date");
  });

  it("explains the merge-build identity when fresh but the deployed SHA differs from the target", () => {
    // Merge-mode: fresh, yet deployed (merge commit) ≠ target (upstream). The
    // banner must say Up to date AND clarify why the two SHAs differ, so it no
    // longer reads as contradicting the impact summary.
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        isFresh={true}
        deployedSha="d7c7b200bcae825c454617ffe36a5353c2318e86"
        targetSha="802224ba8308c641c3211e38e4d2036d8b11655f"
      />,
    );
    expect(html).toContain("Up to date");
    expect(html).toContain("already contains the target");
    expect(html).not.toContain("Update available");
  });

  it("shows maintenance window notice when inMaintenanceWindow is true", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} inMaintenanceWindow={true} />,
    );
    expect(html).toContain("maintenance window");
    expect(html).toContain("next scheduled check");
    expect(html).toContain("May 24, 2026");
  });

  // BI-A6382FB9 — a 24/7 store auto-runs overnight; the panel explains the
  // schedule in plain language instead of asking the operator to configure cron.
  it("shows the 24/7 overnight note when windowSource is auto-overnight", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        windowConfigured={true}
        windowSource="auto-overnight"
        autoWindowSummary="2:00 AM–4:00 AM"
        windowTimezone="America/Chicago"
        nextWindowStart="2026-05-26T02:00:00.000Z"
      />,
    );
    expect(html).toContain("runs 24/7");
    expect(html).toContain("2:00 AM–4:00 AM");
    expect(html).toContain("America/Chicago");
  });

  // BI-A6382FB9 — only when a timezone genuinely can't be derived does the panel
  // ask, and it points at the EXISTING Operating Hours timezone picker.
  it("prompts for a timezone when windowSource is needs-timezone", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} windowConfigured={true} windowSource="needs-timezone" />,
    );
    expect(html).toContain("Set your timezone");
    expect(html).toContain("/storefront/settings/operations");
    expect(html).toContain('data-window-source="needs-timezone"');
  });

  // BI-59591B14 — an active operator blackout pauses scheduled upgrades; the panel
  // explains it (with the blackout name + end) instead of leaving the schedule opaque.
  it("shows a paused-schedule note during an active blackout", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        windowConfigured={true}
        blackoutUntil="2026-07-08T00:00:00.000Z"
        blackoutName="Launch week freeze"
      />,
    );
    expect(html).toContain("Scheduled upgrades paused");
    expect(html).toContain("Launch week freeze");
    expect(html).toContain('data-blackout="true"');
  });
});

// ─── Running ──────────────────────────────────────────────────────────────────

describe("SelfUpgradeClient – running", () => {
  it("shows queued state as accepted work instead of an idle trigger", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        latestRun={makeRun("queued", { startedAt: null, completedAt: null })}
      />,
    );
    expect(html).toContain("Upgrade queued");
    expect(html).toContain("waiting for the worker");
    expect(html).toContain('data-run-status="queued"');
    expect(html).not.toContain('aria-label="Upgrade now"');
  });

  it("shows running badge in the latest run section", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} latestRun={makeRun("running")} />,
    );
    expect(html).toContain("running");
    expect(html).toContain('data-run-status="running"');
  });

  it("shows the run ID", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} latestRun={makeRun("running")} />,
    );
    expect(html).toContain("SUR-0001");
  });

  it("shows version transition", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} latestRun={makeRun("running")} />,
    );
    expect(html).toContain("abc1234");
    expect(html).toContain("def5678");
  });
});

// ─── Succeeded ────────────────────────────────────────────────────────────────

describe("SelfUpgradeClient – succeeded", () => {
  it("shows succeeded badge", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} latestRun={makeRun("succeeded")} />,
    );
    expect(html).toContain("succeeded");
    expect(html).toContain('data-run-status="succeeded"');
  });

  it("shows the triggeredBy source", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} latestRun={makeRun("succeeded")} />,
    );
    expect(html).toContain("Triggered by:");
    expect(html).toContain("scheduled");
  });

  it("shows rollback controls when the latest run has a complete recovery point", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        latestRun={makeRun("succeeded", {
          completionEvidence: {
            recoveryPoint: {
              schemaVersion: 1,
              status: "ok",
              trigger: "pre-upgrade-recovery",
              members: [
                { target: "postgres", runId: "BR-PG", status: "ok" },
                { target: "neo4j", runId: "BR-N4J", status: "ok" },
                { target: "qdrant", runId: "BR-QD", status: "ok" },
              ],
            },
          },
        })}
      />,
    );
    expect(html).toContain("Recovery point: ok");
    expect(html).toContain("postgres: backed up");
    expect(html).toContain("Restore recovery point");
  });

  it("labels intentionally-skipped derived stores as re-derived, not 'missing'", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        latestRun={makeRun("succeeded", {
          completionEvidence: {
            recoveryPoint: {
              schemaVersion: 1,
              status: "ok",
              trigger: "pre-upgrade-recovery",
              // The default postgres-only recovery point: postgres backed up,
              // the derived stores skipped (they re-derive from source).
              members: [
                { target: "postgres", runId: "BR-PG", status: "ok" },
                { target: "neo4j", runId: null, status: "skipped" },
                { target: "qdrant", runId: null, status: "skipped" },
              ],
            },
          },
        })}
      />,
    );
    expect(html).toContain("Recovery point: ok");
    expect(html).toContain("postgres: backed up");
    expect(html).toContain("neo4j: skipped (re-derived)");
    expect(html).toContain("qdrant: skipped (re-derived)");
    // The deliberate skip must never read as a failure/gap.
    expect(html).not.toContain("missing");
  });

  it("does not show rollback button after recovery point rollback succeeds", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        latestRun={makeRun("succeeded", {
          completionEvidence: {
            recoveryPoint: {
              schemaVersion: 1,
              status: "ok",
              trigger: "pre-upgrade-recovery",
              members: [
                { target: "postgres", runId: "BR-PG", status: "ok" },
                { target: "neo4j", runId: "BR-N4J", status: "ok" },
                { target: "qdrant", runId: "BR-QD", status: "ok" },
              ],
            },
            rollback: { status: "ok" },
          },
        })}
      />,
    );
    expect(html).toContain('data-rollback-status="ok"');
    expect(html).not.toContain("Restore recovery point");
  });
});

// ─── Failed ───────────────────────────────────────────────────────────────────

describe("SelfUpgradeClient – failed", () => {
  it("shows actionable portal-owned preflight failure without exposing secrets", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} latestRun={makeRun("failed", {
        completionEvidence: { readiness: {
          stage: "preflight", owner: "portal", mode: "enforced", result: "failed",
          contractVersion: 1, contractDigest: `sha256:${"a".repeat(64)}`,
          failures: [{ code: "state_mount_unwritable", message: "State mount is not writable", remediation: "Repair the lifecycle state mount" }],
        } },
      })} />,
    );
    expect(html).toContain("Pre-drain readiness: failed");
    expect(html).toContain("Validation owner: portal");
    expect(html).toContain("contract v1");
    expect(html).toContain("Repair the lifecycle state mount");
  });

  it("discloses legacy bootstrap as readiness unavailable", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} latestRun={makeRun("succeeded", {
        completionEvidence: { readiness: {
          stage: "preflight", owner: "unavailable", mode: "legacy-bootstrap", result: "unavailable", failures: [],
        } },
      })} />,
    );
    expect(html).toContain("Legacy bootstrap — pre-drain readiness was unavailable");
    expect(html).toContain("Validation owner: unavailable");
    expect(html).not.toContain("Pre-drain readiness: ready");
  });

  it("shows failed badge", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        latestRun={makeRun("failed", { failureLog: "promoter exited with code 1" })}
      />,
    );
    expect(html).toContain("failed");
    expect(html).toContain('data-run-status="failed"');
  });

  it("shows the error message", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        latestRun={makeRun("failed", { failureLog: "promoter exited with code 1" })}
      />,
    );
    expect(html).toContain("promoter exited with code 1");
  });
});

// ─── Skipped ──────────────────────────────────────────────────────────────────

describe("SelfUpgradeClient – skipped", () => {
  it("shows skipped badge", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} latestRun={makeRun("skipped")} />,
    );
    expect(html).toContain("skipped");
    expect(html).toContain('data-run-status="skipped"');
  });

  it("does not show an error section when there is no error", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} latestRun={makeRun("skipped")} />,
    );
    // No error property on a skipped run
    expect(html).not.toContain("promoter exited");
  });

  it("explains WHY a skip happened instead of a silent badge", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        latestRun={makeRun("skipped", {
          reason: "activity-in-flight: build-studio.phase.build, build-studio.phase.build",
        })}
      />,
    );
    // The persisted reason is surfaced (machine string in a data attribute) ...
    expect(html).toContain(
      'data-skip-reason="activity-in-flight: build-studio.phase.build, build-studio.phase.build"',
    );
    // ... and rendered as an operator-facing explanation + remedy.
    expect(html).toContain("Work in progress");
    expect(html).toContain("Build Studio build phase");
    expect(html).toContain("Emergency override");
  });

  it("does not render a skip explanation block for a succeeded run", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} latestRun={makeRun("succeeded")} />,
    );
    expect(html).not.toContain("data-skip-reason");
  });
});

// ─── Trigger control ──────────────────────────────────────────────────────────

describe("SelfUpgradeClient – trigger control", () => {
  it("button has type=button attribute", () => {
    const html = renderToStaticMarkup(<SelfUpgradeClient {...baseStatus} />);
    expect(html).toContain('type="button"');
  });

  it("button is not disabled when no run is active", () => {
    const html = renderToStaticMarkup(<SelfUpgradeClient {...baseStatus} />);
    expect(html).toContain("Upgrade now");
    expect(html).not.toContain('disabled=""');
  });

  // BI-4F3B2FA9: a running upgrade no longer leaves a dead-end disabled button.
  it("shows an in-flight indicator (not a disabled trigger) when a run is running", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} latestRun={makeRun("running")} />,
    );
    expect(html).toContain("Upgrade in progress…");
    expect(html).not.toContain('aria-label="Upgrade now"');
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
      <SelfUpgradeClient {...baseStatus} latestRun={makeRun("running")} quiescence={quiescence} />,
    );
    expect(html).toContain("Force now");
    expect(html).toContain("Abort");
    // Descriptive aria-label names the run; not a dead-end disabled trigger.
    expect(html).toContain("Force upgrade run QR-2026-06-10-test now");
  });
});

// ─── Loading state ────────────────────────────────────────────────────────────

describe("SelfUpgradeClient – loading", () => {
  it("shows Upgrading... text when pending", () => {
    shared.isPending = true;
    const html = renderToStaticMarkup(<SelfUpgradeClient {...baseStatus} />);
    expect(html).toContain("Upgrading...");
    // The idle button label ">Upgrade now<" is replaced while pending (the
    // aria-label "Upgrade now" stays, so assert on the visible button text).
    expect(html).not.toContain(">Upgrade now<");
  });

  it("button is disabled while pending", () => {
    shared.isPending = true;
    const html = renderToStaticMarkup(<SelfUpgradeClient {...baseStatus} />);
    expect(html).toContain('disabled=""');
  });

  it("button has aria-busy=true while pending", () => {
    shared.isPending = true;
    const html = renderToStaticMarkup(<SelfUpgradeClient {...baseStatus} />);
    expect(html).toContain('aria-busy="true"');
  });

  it("shows the 'starting' hint while busy and no run is running yet", () => {
    // The manual trigger only queues the upgrade; the worker takes a few seconds
    // to flip the run to running. The hint reassures the operator so they don't
    // re-click thinking it's broken.
    shared.isPending = true;
    const html = renderToStaticMarkup(<SelfUpgradeClient {...baseStatus} />);
    expect(html).toContain('data-upgrade-starting="true"');
    expect(html).toContain("No need to click again");
  });

  it("does not show the 'starting' hint once a run is already running", () => {
    shared.isPending = false;
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} latestRun={makeRun("running")} />,
    );
    expect(html).not.toContain('data-upgrade-starting="true"');
  });
});

// ─── Success feedback ─────────────────────────────────────────────────────────

describe("SelfUpgradeClient – success feedback", () => {
  it("shows Upgrade queued. when trigger succeeds", () => {
    shared.triggerResult = { queued: true };
    const html = renderToStaticMarkup(<SelfUpgradeClient {...baseStatus} />);
    expect(html).toContain("Upgrade queued.");
  });
});

// ─── Error feedback ───────────────────────────────────────────────────────────

describe("SelfUpgradeClient – error feedback", () => {
  it("shows Not queued message when trigger returns not queued", () => {
    shared.triggerResult = { queued: false, reason: "disabled" };
    const html = renderToStaticMarkup(<SelfUpgradeClient {...baseStatus} />);
    expect(html).toContain("Not queued:");
  });

  it("shows the specific reason for not queuing", () => {
    shared.triggerResult = { queued: false, reason: "already-running" };
    const html = renderToStaticMarkup(<SelfUpgradeClient {...baseStatus} />);
    expect(html).toContain("already-running");
  });
});

// ─── Run history table ────────────────────────────────────────────────────────

describe("SelfUpgradeClient – run history", () => {
  it("renders a Run History section when history rows are provided", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        history={[makeRun("succeeded"), makeRun("failed", { runId: "SUR-0002", failureLog: "oops" })]}
        historyNextCursor={null}
      />,
    );
    expect(html).toContain("Run History");
  });

  it("renders each run ID in the history table", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        history={[makeRun("succeeded"), makeRun("failed", { runId: "SUR-0002", failureLog: "oops" })]}
        historyNextCursor={null}
      />,
    );
    expect(html).toContain("SUR-0001");
    expect(html).toContain("SUR-0002");
  });

  it("renders each run's status badge in the history table", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        history={[makeRun("succeeded"), makeRun("failed", { runId: "SUR-0002", failureLog: "oops" })]}
        historyNextCursor={null}
      />,
    );
    expect(html).toContain("succeeded");
    expect(html).toContain("failed");
  });

  it("shows load-more button when historyNextCursor is set", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        history={[makeRun("succeeded")]}
        historyNextCursor="SUR-0001"
      />,
    );
    expect(html).toContain("Load more");
  });

  it("does not show load-more button when historyNextCursor is null", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        history={[makeRun("succeeded")]}
        historyNextCursor={null}
      />,
    );
    expect(html).not.toContain("Load more");
  });

  it("does not render Run History section when history is empty", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} history={[]} historyNextCursor={null} />,
    );
    expect(html).not.toContain("Run History");
  });

  it("does not render Run History section when history prop is omitted", () => {
    const html = renderToStaticMarkup(<SelfUpgradeClient {...baseStatus} />);
    expect(html).not.toContain("Run History");
  });

  it("renders a When column header for the timestamps", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        history={[makeRun("succeeded")]}
        historyNextCursor={null}
      />,
    );
    expect(html).toContain("When");
  });

  it("renders each run's duration in the history table", () => {
    // baseStatus.latestRun is null, so the only 5m span comes from history.
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        history={[makeRun("succeeded")]}
        historyNextCursor={null}
      />,
    );
    expect(html).toContain("5m");
  });
});

// ─── Latest run – timestamps ──────────────────────────────────────────────────

describe("SelfUpgradeClient – latest run timestamps", () => {
  it("shows a Started label when latestRun has a startedAt", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} latestRun={makeRun("succeeded")} />,
    );
    expect(html).toContain("Started:");
  });

  it("shows duration when both startedAt and completedAt are set", () => {
    // makeRun: startedAt=02:00Z, completedAt=02:05Z → 5 minutes
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} latestRun={makeRun("succeeded")} />,
    );
    expect(html).toContain("5m");
  });

  it("does not show duration when completedAt is null", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        latestRun={makeRun("running", { completedAt: null })}
      />,
    );
    expect(html).not.toContain("5m");
  });

  it("shows a Completed label when a succeeded run has completedAt", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} latestRun={makeRun("succeeded")} />,
    );
    expect(html).toContain("Completed:");
  });

  it("labels the end timestamp as Failed for a failed run", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        latestRun={makeRun("failed", { failureLog: "boom" })}
      />,
    );
    expect(html).toContain("Failed:");
  });

  it("falls back to a Created label when the run never started", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        latestRun={makeRun("skipped", { startedAt: null, completedAt: null })}
      />,
    );
    expect(html).toContain("Created:");
    expect(html).not.toContain("Started:");
  });
});

// ─── Latest run – finish estimate ─────────────────────────────────────────────

describe("SelfUpgradeClient – running finish estimate", () => {
  it("projects an est. done finish time for a running run given past successful runs", () => {
    // history: a 5m successful run (02:00→02:05Z) sets the median duration.
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        latestRun={makeRun("running", {
          startedAt: new Date("2026-05-20T03:00:00Z"),
          completedAt: null,
        })}
        history={[makeRun("succeeded")]}
        historyNextCursor={null}
      />,
    );
    expect(html).toContain("est. done");
  });

  it("does not project a finish time when there is no prior successful run", () => {
    // Only a failed run in history → no duration to learn from.
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        latestRun={makeRun("running", { completedAt: null })}
        history={[makeRun("failed", { runId: "SUR-0002", failureLog: "boom" })]}
        historyNextCursor={null}
      />,
    );
    expect(html).not.toContain("est. done");
  });

  it("does not project a finish time once the run has completed", () => {
    // A completed run shows its actual duration, never an estimate.
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        latestRun={makeRun("succeeded")}
        history={[makeRun("succeeded")]}
        historyNextCursor={null}
      />,
    );
    expect(html).not.toContain("est. done");
  });
});

// ─── No runs yet ──────────────────────────────────────────────────────────────

describe("SelfUpgradeClient – no runs yet", () => {
  it("shows 'No runs yet' when enabled and latestRun is null", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} latestRun={null} />,
    );
    expect(html).toContain("No runs yet");
  });

  it("does not show 'No runs yet' when disabled", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} enabled={false} latestRun={null} />,
    );
    expect(html).not.toContain("No runs yet");
  });

  it("does not show 'No runs yet' when a latestRun exists", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} latestRun={makeRun("succeeded")} />,
    );
    expect(html).not.toContain("No runs yet");
  });
});

// ─── Config summary – null SHAs ───────────────────────────────────────────────

describe("SelfUpgradeClient – config summary null SHAs", () => {
  it("shows 'unknown' when deployedSha is null", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} deployedSha={null} />,
    );
    expect(html).toContain("unknown");
  });

  it("shows 'unknown' when targetSha is null", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} targetSha={null} />,
    );
    expect(html).toContain("unknown");
  });

  it("does not show Update available when targetSha is null", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} targetSha={null} isFresh={false} />,
    );
    expect(html).not.toContain("Update available");
  });
});

// ─── Platform version ────────────────────────────────────────────────────────

describe("SelfUpgradeClient – platform version", () => {
  it("renders the Platform version label and value", () => {
    const html = renderToStaticMarkup(<SelfUpgradeClient {...baseStatus} />);
    expect(html).toContain("Platform version:");
    expect(html).toContain("1.0.0");
  });

  it("renders the 7-char git sha prefix when gitSha is set", () => {
    const html = renderToStaticMarkup(<SelfUpgradeClient {...baseStatus} />);
    // 7-char prefix of "9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1098"
    expect(html).toContain("9f8e7d6");
  });

  it("does not render the git sha element when gitSha is null", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        platformVersion={{
          version: "1.0.0",
          publishedAt: "2026-05-24T00:00:00.000Z",
          gitSha: null,
          note: null,
        }}
      />,
    );
    expect(html).toContain("Platform version:");
    expect(html).toContain("1.0.0");
    expect(html).not.toContain("9f8e7d6");
  });

  it("renders Platform version even when self-upgrade is disabled", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} enabled={false} />,
    );
    expect(html).toContain("Platform version:");
    expect(html).toContain("1.0.0");
  });
});

// ─── Failure-detail disclosure ────────────────────────────────────────────────

describe("SelfUpgradeClient – failure detail", () => {
  it("wraps the error message in a details element", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        latestRun={makeRun("failed", { failureLog: "exit code 1" })}
      />,
    );
    expect(html).toContain("<details");
    expect(html).toContain("exit code 1");
  });

  it("renders a summary element inside the details disclosure", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        latestRun={makeRun("failed", { failureLog: "exit code 1" })}
      />,
    );
    expect(html).toContain("<summary");
  });

  it("does not render a details element when run has no error", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} latestRun={makeRun("succeeded")} />,
    );
    expect(html).not.toContain("<details");
  });
});

// ─── Upgrade activity (drain blockers + cooldown) ──────────────────────────

function drainingActivity(overrides: Record<string, unknown> = {}) {
  return {
    level: "draining" as const,
    runId: "QR-DRAIN",
    enteredAt: "2026-06-06T01:44:00.000Z",
    run: {
      runId: "QR-DRAIN",
      status: "draining",
      trigger: "self-upgrade",
      targetVersion: "abcdef0123456789",
      targetBundleHash: "abcdef0123456789",
      deferSurface: null,
      deferReason: null,
      budgetMs: 300000,
      drainStartedAt: "2026-06-06T01:44:00.000Z",
      lastHeartbeatAt: "2026-06-06T01:44:30.000Z",
    },
    blockersCapturedAt: "2026-06-06T01:44:30.000Z",
    blockers: [
      {
        surface: "build-studio.phase.build",
        label: "Build Studio — build phase",
        kind: "hard" as const,
        count: 1,
        estimatedWaitMs: 1800000,
      },
      {
        surface: "coworker.reasoning-loop",
        label: "AI coworker working",
        kind: "hard" as const,
        count: 6,
        estimatedWaitMs: 30000,
      },
    ],
    ...overrides,
  };
}

describe("SelfUpgradeClient – upgrade activity", () => {
  it("renders the activity panel while draining, listing what's holding the drain", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} quiescence={drainingActivity()} />,
    );
    expect(html).toContain("Upgrade activity");
    expect(html).toContain('data-quiescence-level="draining"');
    expect(html).toContain("Waiting on:");
    expect(html).toContain("Build Studio — build phase");
    expect(html).toContain("AI coworker working");
    // count + worst-case wait surfaced
    expect(html).toContain("×6");
    // target build short hash
    expect(html).toContain("abcdef012345");
  });

  it("does not render the activity panel when level is normal and nothing is cooling down", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        quiescence={{
          level: "normal",
          runId: null,
          enteredAt: "2026-06-06T00:00:00.000Z",
          run: null,
          blockersCapturedAt: null,
          blockers: [],
        }}
      />,
    );
    expect(html).not.toContain("Upgrade activity");
  });

  it("explains a deferred attempt and the cooldown window without claiming work was interrupted", () => {
    const future = new Date(Date.now() + 25 * 60 * 1000).toISOString();
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        cooldownUntil={future}
        quiescence={{
          level: "normal",
          runId: null,
          enteredAt: "2026-06-06T00:00:00.000Z",
          run: {
            runId: "QR-DEFER",
            status: "deferred",
            trigger: "self-upgrade",
            targetVersion: "abcdef0123456789",
            targetBundleHash: "abcdef0123456789",
            deferSurface: "build-studio.phase.build",
            deferReason: "quiescence-deferred",
            budgetMs: 300000,
            drainStartedAt: "2026-06-06T01:40:00.000Z",
            lastHeartbeatAt: "2026-06-06T01:44:00.000Z",
          },
          blockersCapturedAt: "2026-06-06T01:44:00.000Z",
          blockers: [
            {
              surface: "build-studio.phase.build",
              label: "Build Studio — build phase",
              kind: "hard",
              count: 1,
              estimatedWaitMs: 1800000,
            },
          ],
        }}
      />,
    );
    expect(html).toContain("Upgrade activity");
    expect(html).toContain("Last upgrade attempt deferred");
    expect(html).toContain("Build Studio — build phase");
    expect(html).toContain("never interrupted");
    expect(html).toContain("Automatic upgrades paused until");
    expect(html).toContain('data-cooldown="active"');
  });

  it("renders the cooldown notice even with no quiescence run when a cooldown is active", () => {
    const future = new Date(Date.now() + 25 * 60 * 1000).toISOString();
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} cooldownUntil={future} quiescence={null} />,
    );
    expect(html).toContain("Automatic upgrades paused until");
  });
});

describe("Latest Run card — human-readable upgrade scope", () => {
  const digest = {
    counts: { breaking: 1, feature: 5, fix: 3, performance: 0, other: 0, total: 9 },
    headline: "Nine changes since your last upgrade, one breaking.",
  };

  it("leads with the plain-language headline when the run recorded one", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        latestRun={makeRun("succeeded")}
        latestRunImpact={digest}
      />,
    );
    expect(html).toContain('data-impact-scope-headline="run"');
    expect(html).toContain("Nine changes since your last upgrade, one breaking.");
  });

  it("renders the scope ribbon with total and category breakdown", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        latestRun={makeRun("succeeded")}
        latestRunImpact={digest}
      />,
    );
    expect(html).toContain('data-impact-scope-counts="run"');
    expect(html).toContain("9 changes");
    expect(html).toContain("1 breaking · 5 new · 3 fixes");
    // Breaking present -> ribbon takes the destructive color.
    expect(html).toContain("--dpf-destructive");
  });

  it("shortens the SHA pair and keeps the full value as a hover title", () => {
    const long = { currentSha: "1".repeat(40), targetSha: "2".repeat(40) };
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} latestRun={makeRun("succeeded", long)} />,
    );
    expect(html).toContain("data-run-sha-range");
    // Truncated display (12 chars + ellipsis) is what the operator reads —
    // never the full 40-char wall as visible body text.
    expect(html).toContain(`>111111111111…</span>`);
    // Full SHA is preserved for copy/verify via the title attribute only.
    expect(html).toContain(`title="${"1".repeat(40)}"`);
  });

  it("omits the ribbon entirely when the run recorded no summary", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} latestRun={makeRun("succeeded")} />,
    );
    expect(html).not.toContain("data-impact-scope-counts");
    expect(html).not.toContain("data-impact-scope-headline");
    // The SHA identity line still renders.
    expect(html).toContain("data-run-sha-range");
  });

  it("uses muted (non-destructive) ribbon color when nothing is breaking", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        latestRun={makeRun("succeeded")}
        latestRunImpact={{
          counts: { breaking: 0, feature: 2, fix: 1, performance: 0, other: 0, total: 3 },
          headline: null,
        }}
      />,
    );
    expect(html).toContain("2 new · 1 fix");
    // No headline block when the digest headline is null.
    expect(html).not.toContain("data-impact-scope-headline");
  });
});

describe("Update-available banner — at-a-glance scope", () => {
  const okSummary = {
    ok: true as const,
    summary: {
      currentLineageSha: "a".repeat(40),
      targetSha: "b".repeat(40),
      counts: { breaking: 2, feature: 4, fix: 1, performance: 0, other: 0, total: 7 },
      topItems: [],
      allItems: [],
      phrased: {
        headline: "Seven changes are ready, two of them breaking.",
        itemPhrasings: [],
        touchesCustomizationsCallout: "",
      },
      enrichment: { githubReachable: true, prsEnriched: 4 },
      generatedAt: "2026-07-15T00:00:00.000Z",
      fromCache: true,
    },
  };

  it("shows the glance ribbon on the banner when an update is available", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        isFresh={false}
        targetSha={"b".repeat(40)}
        initialImpactSummary={okSummary}
      />,
    );
    expect(html).toContain('data-update-glance="true"');
    expect(html).toContain('data-impact-scope-headline="available"');
    expect(html).toContain("Seven changes are ready, two of them breaking.");
    expect(html).toContain("7 changes");
    expect(html).toContain("2 breaking · 4 new · 1 fix");
  });

  it("omits the glance ribbon when the build is fresh (up to date)", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} isFresh={true} initialImpactSummary={okSummary} />,
    );
    expect(html).not.toContain('data-update-glance="true"');
    expect(html).not.toContain('data-impact-scope-headline="available"');
  });

  it("omits the glance ribbon when the summary did not resolve", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        isFresh={false}
        targetSha={"b".repeat(40)}
        initialImpactSummary={{
          ok: false,
          reason: "no-lineage",
          detail: "No succeeded run yet.",
        }}
      />,
    );
    expect(html).not.toContain('data-update-glance="true"');
    // The plain "Update available" line still renders.
    expect(html).toContain("Update available");
  });
});

// ─── Run History reasons ────────────────────────────────────────────────────
// The reason a run didn't install is persisted (SelfUpgradeRun.reason for skips,
// .failureLog for failures) but was never rendered per row — skipped/failed rows
// showed only a badge. These assert the "why" now surfaces.

describe("SelfUpgradeClient – run history reasons", () => {
  it("surfaces the skip reason for a skipped run", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        history={[
          makeRun("skipped", {
            runId: "SUR-SKIP1",
            reason: "activity-in-flight: coworker.reasoning-loop",
            currentSha: null,
            targetSha: null,
          }),
        ]}
      />,
    );
    expect(html).toContain('data-run-reason-for="SUR-SKIP1"');
    // describeSkipReason("activity-in-flight: …") → title "Work in progress".
    expect(html).toContain("Work in progress");
  });

  it("surfaces a concise classified failure reason for a failed run", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        history={[
          makeRun("failed", {
            runId: "SUR-FAIL1",
            failureLog:
              "[build-failure-class] docker-mount-denied\n" +
              "[build-failure-class] Docker Desktop refused to share /root/.dpf — set DPF_STATE_DIR in the install .env.\n" +
              "[build-failure-class] playbook: docs/runbooks/x.md\n---\nError response from daemon: mounts denied",
          }),
        ]}
      />,
    );
    expect(html).toContain('data-run-reason-for="SUR-FAIL1"');
    // The human summary line surfaces as the visible reason (selection logic is
    // unit-tested separately in conciseFailureReason).
    expect(html).toContain("Docker Desktop refused to share");
  });

  it("shows no reason row for a succeeded run", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        history={[makeRun("succeeded", { runId: "SUR-OK1" })]}
      />,
    );
    expect(html).not.toContain('data-run-reason-for="SUR-OK1"');
  });
});

describe("conciseFailureReason", () => {
  it("prefers the classified human summary over the class id and playbook line", () => {
    const log =
      "[build-failure-class] docker-mount-denied\n" +
      "[build-failure-class] Docker Desktop refused to share /root/.dpf.\n" +
      "[build-failure-class] playbook: docs/runbooks/x.md\n---\nraw error";
    expect(conciseFailureReason(log)).toBe("Docker Desktop refused to share /root/.dpf.");
  });

  it("falls back to the class id when there is no summary line", () => {
    expect(conciseFailureReason("[build-failure-class] promoter-timeout")).toBe("promoter-timeout");
  });

  it("falls back to the last non-empty raw line when unclassified", () => {
    expect(conciseFailureReason("building...\n\nError response from daemon: boom\n")).toBe(
      "Error response from daemon: boom",
    );
  });

  it("truncates very long reasons", () => {
    const long = "[build-failure-class] x\n[build-failure-class] " + "z".repeat(400);
    const out = conciseFailureReason(long)!;
    expect(out.length).toBe(201); // 200 chars + ellipsis
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns null for empty/absent logs", () => {
    expect(conciseFailureReason(null)).toBeNull();
    expect(conciseFailureReason("")).toBeNull();
    expect(conciseFailureReason("   \n  ")).toBeNull();
  });
});
