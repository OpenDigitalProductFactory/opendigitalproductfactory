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
    />
  ),
}));

import { getSelfUpgradeStatus, listSelfUpgradeRuns } from "@/lib/actions/promotions";
import { getPlatformDevConfig } from "@/lib/actions/platform-dev-config";
import SelfUpgradePage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  // Default: install does not customise source — panel stays dormant.
  vi.mocked(getPlatformDevConfig).mockResolvedValue(null as never);
});

const baseStatus = {
  enabled: false,
  channel: "stable",
  inMaintenanceWindow: false,
  windowConfigured: true,
  windowSource: "operating-hours" as const,
  storeOpen: false,
  nextWindowStart: null,
  nextScheduledCheckAt: null,
  deployedSha: null,
  deployedShaSource: "unknown" as const,
  targetSha: null,
  isFresh: false,
  latestRun: null,
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
});
