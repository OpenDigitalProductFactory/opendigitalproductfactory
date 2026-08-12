// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  isSelfUpgradeObservationActive,
  SelfUpgradeLiveProvider,
  useSelfUpgradeLive,
} from "./SelfUpgradeLiveProvider";
import type { SelfUpgradeStatusSnapshot } from "@/lib/self-upgrade/status-snapshot";

const observer = vi.hoisted(() => ({
  value: null as null | {
    snapshot: SelfUpgradeStatusSnapshot;
    refresh: () => Promise<void>;
    pending: boolean;
    error: string | null;
  },
  options: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/hooks/useBackgroundOperationObserver", () => ({
  useBackgroundOperationObserver: (options: Record<string, unknown>) => {
    observer.options = options;
    return observer.value;
  },
}));

const initialSnapshot: SelfUpgradeStatusSnapshot = {
  observedAt: "2026-08-01T00:00:00.000Z",
  latestRun: null,
  quiescence: {
    level: "normal" as const,
    runId: null,
    enteredAt: "2026-08-01T00:00:00.000Z",
    run: null,
    blockersCapturedAt: null,
    blockers: [],
  },
  cooldownUntil: null,
  jobEngine: {
    status: "healthy" as const,
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
};

function Consumer() {
  const live = useSelfUpgradeLive();
  return <div>{live.snapshot.latestRun?.status ?? "idle"}</div>;
}

describe("SelfUpgradeLiveProvider", () => {
  it.each(["queued", "pending", "running"])(
    "keeps observation active for a %s run",
    (status) => {
      expect(
        isSelfUpgradeObservationActive({
          ...initialSnapshot,
          latestRun: {
            runId: "SUR-ACTIVE",
            status,
            trigger: null,
            currentSha: null,
            targetSha: null,
            deployedSha: null,
            reason: null,
            startedAt: null,
            completedAt: null,
            failureLog: null,
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        }),
      ).toBe(true);
    },
  );

  it("stays active for quiescence and stops after a normal terminal run", () => {
    expect(
      isSelfUpgradeObservationActive({
        ...initialSnapshot,
        quiescence: { ...initialSnapshot.quiescence, level: "draining" },
      }),
    ).toBe(true);
    expect(
      isSelfUpgradeObservationActive({
        ...initialSnapshot,
        latestRun: {
          runId: "SUR-DONE",
          status: "succeeded",
          trigger: null,
          currentSha: null,
          targetSha: null,
          deployedSha: null,
          reason: null,
          startedAt: null,
          completedAt: "2026-08-01T00:01:00.000Z",
          failureLog: null,
          createdAt: "2026-08-01T00:00:00.000Z",
        },
      }),
    ).toBe(false);
  });

  it("provides the shared targeted observer to every self-upgrade surface", () => {
    observer.value = {
      snapshot: {
        ...initialSnapshot,
        latestRun: {
          runId: "SUR-1",
          status: "running",
          trigger: null,
          currentSha: null,
          targetSha: null,
          deployedSha: null,
          reason: null,
          startedAt: null,
          completedAt: null,
          failureLog: null,
          createdAt: "2026-08-01T00:00:00.000Z",
        },
      },
      refresh: vi.fn().mockResolvedValue(undefined),
      pending: false,
      error: null,
    };

    render(
      <SelfUpgradeLiveProvider initialSnapshot={initialSnapshot}>
        <Consumer />
        <Consumer />
      </SelfUpgradeLiveProvider>,
    );

    expect(screen.getAllByText("running")).toHaveLength(2);
    expect(observer.options).toMatchObject({
      endpoint: "/api/ops/self-upgrade/status",
      eventType: "system:self-upgrade",
    });
  });
});
