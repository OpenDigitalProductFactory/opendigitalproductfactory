import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SelfUpgradeRunDto } from "@/lib/actions/promotions";

vi.mock("@/lib/actions/promotions", () => ({
  getSelfUpgradeStatus: vi.fn(),
  listSelfUpgradeRuns: vi.fn(),
}));

vi.mock("@/components/ops/OpsTabNav", () => ({
  OpsTabNav: () => <div data-testid="ops-tab-nav" />,
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
import SelfUpgradePage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
});

const baseStatus = {
  enabled: false,
  channel: "stable",
  inMaintenanceWindow: false,
  windowConfigured: false,
  nextWindowStart: null,
  deployedSha: null,
  deployedShaSource: "unknown" as const,
  targetSha: null,
  isFresh: false,
  latestRun: null,
  platformVersion: {
    version: "1.0.0",
    publishedAt: "2026-05-24T00:00:00.000Z",
    gitSha: "abc1234",
    imageVersion: null,
    buildDate: null,
    note: "baseline",
  },
} as const;

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
});
