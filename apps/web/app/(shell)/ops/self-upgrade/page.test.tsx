import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SelfUpgradeRunDto } from "@/lib/actions/promotions";

vi.mock("@/lib/actions/promotions", () => ({
  getSelfUpgradeStatus: vi.fn(),
  listSelfUpgradeRuns: vi.fn(),
}));

vi.mock("@/lib/actions/platform-dev-config", () => ({
  getPlatformDevConfig: vi.fn(),
}));

vi.mock("@/lib/self-upgrade/impact", () => ({
  loadPersistedImpactSummary: vi.fn().mockResolvedValue(null),
  summarizeUpgradeImpact: vi
    .fn()
    .mockResolvedValue({ ok: false, reason: "no-lineage", detail: "no lineage" }),
  // BI-5B1FDA09: the merged-PR labels resolve from the upstream lineage marker.
  resolveCurrentLineageSha: vi
    .fn()
    .mockResolvedValue("3c46e27d97781d4663d80ea097a1e9f3dd7f1cdf"),
}));

vi.mock("@/lib/self-upgrade/config", () => ({
  getSelfUpgradeConfig: vi.fn().mockResolvedValue({ hostSourceMountPath: "/host/dpf" }),
}));

vi.mock("@/lib/self-upgrade/target-binding", () => ({
  createSelfUpgradeTargetBinding: vi.fn().mockReturnValue("server-signed-target"),
}));

vi.mock("@/lib/self-upgrade/merge-point", () => ({
  resolveUpgradeMergePoints: vi.fn().mockResolvedValue({
    running: {
      sha: "3c46e27d97781d4663d80ea097a1e9f3dd7f1cdf",
      prNumber: 3746,
      description: "make amcheck success Prisma-safe",
      label: "PR #3746",
    },
    available: {
      sha: "59f8826e448bdb85580633cdc2ad21fb05bfafd1",
      prNumber: 3747,
      description: "materialize hermetic replay dependencies",
      label: "PR #3747",
    },
  }),
}));

vi.mock("@/components/ops/OpsTabNav", () => ({
  OpsTabNav: () => <div data-testid="ops-tab-nav" />,
}));

// BI-D43EB266: the source-merge sub-step is folded into the Self-Upgrade page.
vi.mock("@/components/admin/PlatformUpdateApplyPanel", () => ({
  PlatformUpdateApplyPanel: (props: { updatePending: boolean; pendingVersion: string | null }) => (
    <div
      data-testid="platform-update-apply-panel"
      data-update-pending={String(props.updatePending)}
      data-pending-version={props.pendingVersion ?? ""}
    />
  ),
}));

vi.mock("@/components/ops/SelfUpgradeClient", () => ({
  default: (props: {
    enabled: boolean;
    channel: string;
    inMaintenanceWindow: boolean;
    isFresh: boolean;
    history?: unknown[];
    historyNextCursor?: string | null;
    platformVersion?: { version: string; gitSha: string | null };
    mergePoints?: {
      running: { prNumber: number | null } | null;
      available: { prNumber: number | null } | null;
    } | null;
  }) => (
    <div
      data-testid="self-upgrade-client"
      data-enabled={String(props.enabled)}
      data-channel={props.channel}
      data-in-maintenance-window={String(props.inMaintenanceWindow)}
      data-is-fresh={String(props.isFresh)}
      data-history-count={String(props.history?.length ?? 0)}
      data-history-cursor={props.historyNextCursor ?? ""}
      data-platform-version={props.platformVersion?.version ?? ""}
      data-platform-git-sha={props.platformVersion?.gitSha ?? ""}
      data-running-pr={props.mergePoints?.running?.prNumber ?? ""}
      data-available-pr={props.mergePoints?.available?.prNumber ?? ""}
    />
  ),
}));

// The shell owns SystemEventProvider. Page tests render this route in isolation,
// so keep the live-provider boundary visible without requiring shell context;
// its observation behavior is covered by SelfUpgradeLiveProvider.test.tsx.
vi.mock("@/components/ops/SelfUpgradeLiveProvider", () => ({
  SelfUpgradeLiveProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// BI-8D87084D: owner-readable release card fronts the technical ledger. Stub it
// to surface the derived state; the summary derivation itself is unit-tested in
// lib/self-upgrade/owner-summary.test.ts. BI-D77BF495: also render the
// primaryAction slot (unlike the other stubs, which discard their content) so
// page-level tests can assert the trigger control is co-located INSIDE the
// card, not merely passed as a prop nobody renders.
vi.mock("@/components/ops/OwnerReleaseCard", () => ({
  OwnerReleaseCard: (props: { summary: { state: string; availableVersion: string | null }; primaryAction?: React.ReactNode }) => (
    <div
      data-testid="owner-release-card"
      data-release-state={props.summary.state}
      data-available-version={props.summary.availableVersion ?? ""}
    >
      {props.primaryAction}
    </div>
  ),
}));

// BI-D77BF495: the live trigger, stubbed the same way as the other child
// components — this file owns page-level wiring (is it rendered, is it
// co-located with the release card), not the trigger's own behavior (covered
// in SelfUpgradeTriggerControl.test.tsx).
vi.mock("@/components/ops/SelfUpgradeTriggerControl", () => ({
  default: (props: { enabled: boolean; channel: string; actionState: string; targetBinding?: string | null }) => (
    <div
      data-testid="self-upgrade-trigger-control"
      data-enabled={String(props.enabled)}
      data-channel={props.channel}
      data-action-state={props.actionState}
      data-target-binding={props.targetBinding ?? ""}
    />
  ),
}));

vi.mock("@/lib/self-upgrade/local-changes-ledger", () => ({
  getLocalChangesLedger: vi.fn().mockResolvedValue({ available: true, changes: [] }),
}));

vi.mock("@/components/ops/LocalChangesLedger", () => ({
  LocalChangesLedger: () => <div data-testid="local-changes-ledger" />,
}));

// The page reads the Simple/Full nav-mode cookie to decide the Advanced default.
// vi.hoisted so the (hoisted) vi.mock factory can reference the fn without a TDZ.
const { mockCookieGet } = vi.hoisted(() => ({ mockCookieGet: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ get: mockCookieGet }),
}));

import { getSelfUpgradeStatus, listSelfUpgradeRuns } from "@/lib/actions/promotions";
import { getPlatformDevConfig } from "@/lib/actions/platform-dev-config";
import { loadPersistedImpactSummary, summarizeUpgradeImpact } from "@/lib/self-upgrade/impact";
import { resolveUpgradeMergePoints } from "@/lib/self-upgrade/merge-point";
import SelfUpgradePage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  // Default: install does not customise source — panel stays dormant.
  vi.mocked(getPlatformDevConfig).mockResolvedValue(null as never);
  // Default nav-mode: no cookie → Full (operator) → Advanced expanded.
  mockCookieGet.mockReturnValue(undefined);
});

const baseStatus = {
  enabled: false,
  support: {
    configuredEnabled: false,
    supported: true as const,
    enabled: false,
    targetKind: "git-source" as const,
    reason: "disabled-by-config" as const,
    message: "Automatic updates are turned off for this source-backed install.",
  },
  channel: "stable",
  inMaintenanceWindow: false,
  windowConfigured: true,
  windowSource: "operating-hours" as const,
  autoWindowSummary: null,
  blackoutUntil: null,
  blackoutName: null,
  storeOpen: false,
  windowTimezone: "UTC",
  nextWindowStart: null,
  nextScheduledCheckAt: null,
  deployedSha: null,
  deployedShaSource: "unknown" as const,
  targetSha: null,
  targetTag: null,
  targetAvailability: "unavailable" as const,
  targetUnavailableReason: "no-target",
  currentConfigDigest: null,
  isFresh: false,
  releaseBatch: {
    applicable: true,
    eligible: true,
    reason: "tally-uncomputable" as const,
    pendingCount: null,
    minPendingPrs: 10,
    maxWaitHours: 168,
    oldestPendingAt: null,
    summary: "Pending-update tally unavailable — routine upgrades proceed without batching.",
  },
  latestRun: null,
  latestRunImpact: null,
  quiescence: {
    level: "normal" as const,
    runId: null,
    enteredAt: "1970-01-01T00:00:00.000Z",
    run: null,
    blockersCapturedAt: null,
    blockers: [],
  },
  admission: {
    lane: { enabled: false, limit: null, key: "dpf-build-pipeline" },
    buildHolders: 0,
    totalHolders: 0,
    summary:
      "Build-pipeline lane uncapped — set DPF_BUILD_PIPELINE_CONCURRENCY to reserve self-upgrade headroom; nothing holding capacity.",
  },
  cooldownUntil: null,
  jobEngine: {
    status: "healthy" as const,
    detail: null,
    checkedAt: "2026-05-24T00:00:00.000Z",
    watchdog: {
      status: "healthy" as const,
      detail: null,
      lastInvocationAt: "2026-05-24T00:00:00.000Z",
      lastGatewayHitAt: "2026-05-24T00:00:00.000Z",
      lastRecoveryAttemptAt: null,
      lastRecoverySummary: null,
    },
  },
  platformVersion: {
    version: "1.0.0",
    publishedAt: "2026-05-24T00:00:00.000Z",
    gitSha: "abc1234",
    imageVersion: null,
    buildDate: null,
    note: "baseline",
  },
};

describe("SelfUpgradePage", () => {
  it("renders page title and ops tab nav", async () => {
    vi.mocked(getSelfUpgradeStatus).mockResolvedValue(baseStatus);
    vi.mocked(listSelfUpgradeRuns).mockResolvedValue({ runs: [], nextCursor: null });

    const html = renderToStaticMarkup(await SelfUpgradePage());

    expect(html).toContain("Self-Upgrade");
    expect(html).toContain('data-testid="ops-tab-nav"');
    expect(html).toContain('data-testid="self-upgrade-client"');
    expect(html).not.toContain("plain-language status");
    expect(html).not.toContain("Run logs, runtime and security checks");
    expect(html).toContain("Upgrade status.");
    expect(html).toContain("Details");
  });

  it("passes status fields to SelfUpgradeClient", async () => {
    vi.mocked(getSelfUpgradeStatus).mockResolvedValue({
      ...baseStatus,
      enabled: true,
      channel: "stable",
      inMaintenanceWindow: true,
      isFresh: false,
    });
    vi.mocked(listSelfUpgradeRuns).mockResolvedValue({ runs: [], nextCursor: null });

    const html = renderToStaticMarkup(await SelfUpgradePage());

    expect(html).toContain('data-enabled="true"');
    expect(html).toContain('data-channel="stable"');
    expect(html).toContain('data-in-maintenance-window="true"');
    expect(html).toContain('data-is-fresh="false"');
  });

  it("passes history runs and cursor to SelfUpgradeClient", async () => {
    const run: SelfUpgradeRunDto = {
      runId: "run-1",
      status: "succeeded",
      trigger: null,
      currentSha: "abc123",
      targetSha: "def456",
      deployedSha: null,
      reason: null,
      startedAt: new Date("2025-01-01"),
      completedAt: new Date("2025-01-01"),
      failureLog: null,
      createdAt: new Date("2025-01-01"),
    };
    vi.mocked(getSelfUpgradeStatus).mockResolvedValue(baseStatus);
    vi.mocked(listSelfUpgradeRuns).mockResolvedValue({
      runs: [run],
      nextCursor: "cursor-abc",
    });

    const html = renderToStaticMarkup(await SelfUpgradePage());

    expect(html).toContain('data-history-count="1"');
    expect(html).toContain('data-history-cursor="cursor-abc"');
  });

  it("passes null cursor when no more history pages", async () => {
    vi.mocked(getSelfUpgradeStatus).mockResolvedValue(baseStatus);
    vi.mocked(listSelfUpgradeRuns).mockResolvedValue({ runs: [], nextCursor: null });

    const html = renderToStaticMarkup(await SelfUpgradePage());

    expect(html).toContain('data-history-cursor=""');
  });

  it("passes platformVersion to SelfUpgradeClient", async () => {
    vi.mocked(getSelfUpgradeStatus).mockResolvedValue(baseStatus);
    vi.mocked(listSelfUpgradeRuns).mockResolvedValue({ runs: [], nextCursor: null });

    const html = renderToStaticMarkup(await SelfUpgradePage());

    expect(html).toContain('data-platform-version="1.0.0"');
    expect(html).toContain('data-platform-git-sha="abc1234"');
  });

  it("renders the source-merge sub-step with the install's pending update state (BI-D43EB266)", async () => {
    vi.mocked(getSelfUpgradeStatus).mockResolvedValue(baseStatus);
    vi.mocked(listSelfUpgradeRuns).mockResolvedValue({ runs: [], nextCursor: null });
    vi.mocked(getPlatformDevConfig).mockResolvedValue({
      updatePending: true,
      pendingVersion: "v9c92036a",
    } as never);

    const html = renderToStaticMarkup(await SelfUpgradePage());

    expect(html).toContain('data-testid="platform-update-apply-panel"');
    expect(html).toContain('data-update-pending="true"');
    expect(html).toContain('data-pending-version="v9c92036a"');
  });

  it("leaves the source-merge sub-step dormant when the install does not customise source", async () => {
    vi.mocked(getSelfUpgradeStatus).mockResolvedValue(baseStatus);
    vi.mocked(listSelfUpgradeRuns).mockResolvedValue({ runs: [], nextCursor: null });

    const html = renderToStaticMarkup(await SelfUpgradePage());

    expect(html).toContain('data-update-pending="false"');
  });

  it("passes merged-PR identity for both ends of the comparison (BI-5B1FDA09)", async () => {
    vi.mocked(getSelfUpgradeStatus).mockResolvedValue({
      ...baseStatus,
      enabled: true,
      isFresh: false,
      targetSha: "59f8826e448bdb85580633cdc2ad21fb05bfafd1",
    } as never);
    vi.mocked(listSelfUpgradeRuns).mockResolvedValue({ runs: [], nextCursor: null });

    const html = renderToStaticMarkup(await SelfUpgradePage());

    expect(html).toContain('data-running-pr="3746"');
    expect(html).toContain('data-available-pr="3747"');
    // Resolved from the UPSTREAM lineage marker, not the local merge-commit id:
    // a merge commit's subject carries no `(#N)` and would label as bare hex.
    expect(resolveUpgradeMergePoints).toHaveBeenCalledWith(
      expect.objectContaining({
        runningSha: "3c46e27d97781d4663d80ea097a1e9f3dd7f1cdf",
        targetSha: "59f8826e448bdb85580633cdc2ad21fb05bfafd1",
      }),
    );
  });

  it("skips merge-point resolution when there is no target to compare (BI-5B1FDA09)", async () => {
    vi.mocked(getSelfUpgradeStatus).mockResolvedValue({
      ...baseStatus,
      enabled: true,
      targetSha: null,
    } as never);
    vi.mocked(listSelfUpgradeRuns).mockResolvedValue({ runs: [], nextCursor: null });

    const html = renderToStaticMarkup(await SelfUpgradePage());

    expect(resolveUpgradeMergePoints).not.toHaveBeenCalled();
    expect(html).toContain('data-running-pr=""');
  });

  it("uses release identity directly without Git merge-point resolution", async () => {
    vi.mocked(getSelfUpgradeStatus).mockResolvedValue({
      ...baseStatus,
      enabled: true,
      support: {
        configuredEnabled: true,
        supported: true,
        enabled: true,
        targetKind: "release-artifact",
        reason: "enabled",
        message: null,
      },
      isFresh: false,
      targetSha: "b".repeat(40),
      targetTag: "v2026.08.24",
      targetAvailability: "resolved",
      targetUnavailableReason: null,
    } as never);
    vi.mocked(listSelfUpgradeRuns).mockResolvedValue({ runs: [], nextCursor: null });

    const html = renderToStaticMarkup(await SelfUpgradePage());

    expect(resolveUpgradeMergePoints).not.toHaveBeenCalled();
    expect(html).toContain('data-available-version="v2026.08.24"');
    expect(html).toContain('data-target-binding="server-signed-target"');
  });

  it("loads only the persisted impact summary during render when an update is available", async () => {
    vi.mocked(getSelfUpgradeStatus).mockResolvedValue({
      ...baseStatus,
      enabled: true,
      isFresh: false,
      targetSha: "b".repeat(40),
      targetAvailability: "resolved",
    });
    vi.mocked(listSelfUpgradeRuns).mockResolvedValue({ runs: [], nextCursor: null });

    await SelfUpgradePage();

    // Cache misses are generated by UpgradeImpactPanel after first paint.
    expect(summarizeUpgradeImpact).not.toHaveBeenCalled();
    expect(loadPersistedImpactSummary).toHaveBeenCalled();
  });

  it("does not auto-generate when the build is already fresh", async () => {
    vi.mocked(getSelfUpgradeStatus).mockResolvedValue({
      ...baseStatus,
      enabled: true,
      isFresh: true,
      targetSha: "b".repeat(40),
      targetAvailability: "resolved",
    });
    vi.mocked(listSelfUpgradeRuns).mockResolvedValue({ runs: [], nextCursor: null });

    await SelfUpgradePage();

    expect(summarizeUpgradeImpact).not.toHaveBeenCalled();
    expect(loadPersistedImpactSummary).toHaveBeenCalled();
  });

  it("renders the owner release card ahead of the advanced controls (BI-8D87084D)", async () => {
    vi.mocked(getSelfUpgradeStatus).mockResolvedValue({
      ...baseStatus,
      enabled: true,
      isFresh: false,
      targetSha: "b".repeat(40),
      targetAvailability: "resolved",
    });
    vi.mocked(listSelfUpgradeRuns).mockResolvedValue({ runs: [], nextCursor: null });

    const html = renderToStaticMarkup(await SelfUpgradePage());

    // Owner card first, derived state exposed.
    expect(html).toContain('data-testid="owner-release-card"');
    expect(html).toContain('data-release-state="update-available"');
    expect(html).toContain('data-action-state="update-available"');
    // Technical controls preserved, now under an Advanced disclosure.
    expect(html).toContain('data-component="self-upgrade-advanced-toggle"');
    expect(html).toContain('data-testid="self-upgrade-client"');
    // Owner card is positioned before the advanced disclosure toggle.
    expect(html.indexOf('data-testid="owner-release-card"')).toBeLessThan(
      html.indexOf('data-component="self-upgrade-advanced-toggle"'),
    );
  });

  it("keeps retry available after a failed attempt when the release is still newer", async () => {
    vi.mocked(getSelfUpgradeStatus).mockResolvedValue({
      ...baseStatus,
      enabled: true,
      isFresh: false,
      targetSha: "b".repeat(40),
      targetAvailability: "resolved",
      targetUnavailableReason: null,
      latestRun: {
        runId: "SUR-retry",
        status: "failed",
        reason: "health-check-failed",
        targetSha: "b".repeat(40),
        completionEvidence: null,
      },
    } as never);
    vi.mocked(listSelfUpgradeRuns).mockResolvedValue({ runs: [], nextCursor: null });

    const html = renderToStaticMarkup(await SelfUpgradePage());

    expect(html).toContain('data-release-state="failed"');
    expect(html).toContain('data-action-state="update-available"');
  });

  it("co-locates the primary trigger with the release status card, reachable on arrival in BOTH nav modes (BI-D77BF495)", async () => {
    vi.mocked(getSelfUpgradeStatus).mockResolvedValue(baseStatus);
    vi.mocked(listSelfUpgradeRuns).mockResolvedValue({ runs: [], nextCursor: null });

    // The trigger now lives inside OwnerReleaseCard, never inside the
    // collapsible Advanced <details> — so it is reachable regardless of nav
    // mode without the details element needing to be forced open.
    const fullHtml = renderToStaticMarkup(await SelfUpgradePage());
    expect(fullHtml).toContain('data-testid="owner-release-card"');
    expect(fullHtml).toContain('data-testid="self-upgrade-trigger-control"');
    expect(fullHtml.indexOf('data-testid="self-upgrade-trigger-control"')).toBeLessThan(
      fullHtml.indexOf('data-component="self-upgrade-advanced-toggle"'),
    );

    mockCookieGet.mockReturnValue({ value: "worker" });
    const simpleHtml = renderToStaticMarkup(await SelfUpgradePage());
    expect(simpleHtml).toContain('data-testid="self-upgrade-trigger-control"');
    expect(simpleHtml.indexOf('data-testid="self-upgrade-trigger-control"')).toBeLessThan(
      simpleHtml.indexOf('data-component="self-upgrade-advanced-toggle"'),
    );
  });

  // BI-D77BF495: now that the trigger is co-located with the release status
  // card (not gated by this disclosure), the Advanced section holding only
  // history/ledgers/logs can go back to the ordinary owner-first pattern —
  // open in Full (operator) mode, collapsed by default in Simple (worker)
  // mode — instead of being force-held open as the BI-D77BF495 stopgap.
  it("collapses the Advanced (history/ledgers/logs) section by default in Simple nav mode", async () => {
    vi.mocked(getSelfUpgradeStatus).mockResolvedValue(baseStatus);
    vi.mocked(listSelfUpgradeRuns).mockResolvedValue({ runs: [], nextCursor: null });

    const fullHtml = renderToStaticMarkup(await SelfUpgradePage());
    expect(fullHtml).toMatch(/<details[^>]*\sopen/);

    mockCookieGet.mockReturnValue({ value: "worker" });
    const simpleHtml = renderToStaticMarkup(await SelfUpgradePage());
    expect(simpleHtml).not.toMatch(/<details[^>]*\sopen/);
    expect(simpleHtml).toContain('data-component="self-upgrade-advanced-toggle"');
  });

  // The trigger's own primary/next-action markers and behavior live inside
  // SelfUpgradeTriggerControl, which this page test mocks to a stub — so they
  // are asserted in that component's own tests, not here. This page test owns
  // the page-level concern: the trigger is rendered co-located with the
  // release card, ahead of (outside) the collapsible Advanced section.
});
