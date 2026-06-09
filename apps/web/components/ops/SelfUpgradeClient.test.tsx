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

import SelfUpgradeClient from "./SelfUpgradeClient";

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

  it("shows maintenance window notice when inMaintenanceWindow is true", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} inMaintenanceWindow={true} />,
    );
    expect(html).toContain("maintenance window");
    expect(html).toContain("next scheduled check");
    expect(html).toContain("May 24, 2026");
  });
});

// ─── Running ──────────────────────────────────────────────────────────────────

describe("SelfUpgradeClient – running", () => {
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
    expect(html).toContain("postgres:BR-PG");
    expect(html).toContain("Restore recovery point");
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

  it("button is disabled when latest run is currently running", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} latestRun={makeRun("running")} />,
    );
    expect(html).toContain('disabled=""');
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
