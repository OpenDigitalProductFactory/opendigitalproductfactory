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
      return [initial, vi.fn()] as const;
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/promotions", () => ({
  triggerSelfUpgrade: vi.fn(),
}));

import SelfUpgradeClient from "./SelfUpgradeClient";

const baseStatus = {
  enabled: true,
  channel: "stable",
  inMaintenanceWindow: false,
  deployedSha: "abc1234",
  targetSha: "def5678",
  isFresh: false,
  latestRun: null,
};

function makeRun(status: string, overrides: Record<string, unknown> = {}) {
  return {
    runId: "SUR-0001",
    status,
    triggeredBy: "scheduled",
    fromVersion: "abc1234",
    toVersion: "def5678",
    startedAt: new Date("2026-05-20T02:00:00Z"),
    completedAt: new Date("2026-05-20T02:05:00Z"),
    error: null as string | null,
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

  it("does not render the Trigger Now button when disabled", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient {...baseStatus} enabled={false} />,
    );
    expect(html).not.toContain("Trigger Now");
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

  it("renders the Trigger Now button when enabled", () => {
    const html = renderToStaticMarkup(<SelfUpgradeClient {...baseStatus} />);
    expect(html).toContain("Trigger Now");
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
});

// ─── Failed ───────────────────────────────────────────────────────────────────

describe("SelfUpgradeClient – failed", () => {
  it("shows failed badge", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        latestRun={makeRun("failed", { error: "promoter exited with code 1" })}
      />,
    );
    expect(html).toContain("failed");
    expect(html).toContain('data-run-status="failed"');
  });

  it("shows the error message", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        latestRun={makeRun("failed", { error: "promoter exited with code 1" })}
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
    expect(html).toContain("Trigger Now");
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
  it("shows Triggering... text when pending", () => {
    shared.isPending = true;
    const html = renderToStaticMarkup(<SelfUpgradeClient {...baseStatus} />);
    expect(html).toContain("Triggering...");
    expect(html).not.toContain("Trigger Now");
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
        history={[makeRun("succeeded"), makeRun("failed", { runId: "SUR-0002", error: "oops" })]}
        historyNextCursor={null}
      />,
    );
    expect(html).toContain("Run History");
  });

  it("renders each run ID in the history table", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        history={[makeRun("succeeded"), makeRun("failed", { runId: "SUR-0002", error: "oops" })]}
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
        history={[makeRun("succeeded"), makeRun("failed", { runId: "SUR-0002", error: "oops" })]}
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

// ─── Failure-detail disclosure ────────────────────────────────────────────────

describe("SelfUpgradeClient – failure detail", () => {
  it("wraps the error message in a details element", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        latestRun={makeRun("failed", { error: "exit code 1" })}
      />,
    );
    expect(html).toContain("<details");
    expect(html).toContain("exit code 1");
  });

  it("renders a summary element inside the details disclosure", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeClient
        {...baseStatus}
        latestRun={makeRun("failed", { error: "exit code 1" })}
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
