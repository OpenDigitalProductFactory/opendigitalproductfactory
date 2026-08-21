// @vitest-environment jsdom
//
// apps/web/components/build/FleetRail.test.tsx
//
// Pins the FleetRail contract:
//   - Header label format + role=status + aria-live polite (queue surface
//     amendment PR #898).
//   - Default sort: running → blocked → queued (by position) → idle.
//   - Header click invokes onOpenQueueDrawer.
//   - Row select / delete propagate to the right entry.

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FleetRail, formatFleetHeader, sortFleetEntries, type FleetRailEntry } from "./FleetRail";
import { formatOperatorFocusHeader } from "./fleet-derivation";
import {
  normalizeHappyPathState,
  type FeatureBuildRow,
} from "@/lib/feature-build-types";

afterEach(cleanup);

function makeBuild(overrides: Partial<FeatureBuildRow> = {}): FeatureBuildRow {
  return {
    id: `row-${overrides.buildId ?? "X"}`,
    buildId: "FB-AAAAAAAA",
    title: "A build",
    description: null,
    portfolioId: null,
    originatingBacklogItemId: null,
    brief: null,
    plan: null,
    phase: "build",
    sandboxId: null,
    sandboxPort: null,
    diffSummary: null,
    diffPatch: null,
    codingProvider: null,
    threadId: null,
    digitalProductId: null,
    product: null,
    createdById: "user-1",
    createdAt: new Date("2026-05-21T00:00:00Z"),
    updatedAt: new Date("2026-05-21T00:00:00Z"),
    draftApprovedAt: null,
    designDoc: null,
    designReview: null,
    buildPlan: null,
    planReview: null,
    taskResults: null,
    verificationOut: null,
    acceptanceMet: null,
    scoutFindings: null,
    uxTestResults: null,
    uxVerificationStatus: null,
    accountableEmployeeId: null,
    claimedByAgentId: null,
    claimedAt: null,
    claimStatus: null,
    buildExecState: null,
    deliberationSummary: null,
    happyPathState: normalizeHappyPathState(null),
    originator: null,
    phaseHandoffs: [],
    ...overrides,
  };
}

function entry(
  buildId: string,
  queueState: FleetRailEntry["queueState"],
  needsOwner = false,
): FleetRailEntry {
  return {
    build: makeBuild({ buildId, title: `Build ${buildId}` }),
    lifecycleLabel: null,
    queueState,
    attention: {
      state: needsOwner ? "waiting-owner" : "working",
      reason: needsOwner ? "Ready for your release decision." : null,
      needsOwner,
      fromRuntimeSignal: false,
    },
  };
}

describe("formatFleetHeader", () => {
  it("uses the current operator-focus wording for legacy callers", () => {
    expect(formatFleetHeader(2, 3, 4)).toBe("Needs you: 0 · Working: 2 · Waiting: 4 · Parked: 0");
    expect(formatFleetHeader(0, 5, 0)).toBe("Needs you: 0 · Working: 0 · Parked: 0");
  });
});

describe("formatOperatorFocusHeader", () => {
  it("formats the human-facing FleetRail summary", () => {
    expect(
      formatOperatorFocusHeader({
        needsYouCount: 1,
        workingCount: 2,
        queuedCount: 3,
        parkedCount: 4,
      }),
    ).toBe("Needs you: 1 · Working: 2 · Waiting: 3 · Parked: 4");
  });
});

describe("sortFleetEntries", () => {
  it("orders by queueState.kind: running → blocked → queued → idle", () => {
    const idle = entry("FB-1IDLE", { kind: "idle" });
    const queued2 = entry("FB-2QQQQQQ", { kind: "queued", position: 2, reason: "capacity", ahead: 1 });
    const blocked = entry("FB-3BLOCK", { kind: "blocked", reason: "x" });
    const running = entry("FB-4RUN", { kind: "running", stepLabel: null });
    const sorted = sortFleetEntries([idle, queued2, blocked, running]);
    expect(sorted.map((e) => e.build.buildId)).toEqual([
      "FB-4RUN",
      "FB-3BLOCK",
      "FB-2QQQQQQ",
      "FB-1IDLE",
    ]);
  });

  it("orders multiple queued entries by position ascending", () => {
    const q3 = entry("FB-QQQ3", { kind: "queued", position: 3, reason: "capacity", ahead: 2 });
    const q1 = entry("FB-QQQ1", { kind: "queued", position: 1, reason: "capacity", ahead: 0 });
    const q2 = entry("FB-QQQ2", { kind: "queued", position: 2, reason: "capacity", ahead: 1 });
    const sorted = sortFleetEntries([q3, q1, q2]);
    expect(sorted.map((e) => e.build.buildId)).toEqual([
      "FB-QQQ1",
      "FB-QQQ2",
      "FB-QQQ3",
    ]);
  });

  it("breaks same-kind ties (non-queued) by buildId ascending for stable rendering", () => {
    const a = entry("FB-ARUNA", { kind: "running", stepLabel: null });
    const b = entry("FB-BRUNB", { kind: "running", stepLabel: null });
    const sorted = sortFleetEntries([b, a]);
    expect(sorted.map((e) => e.build.buildId)).toEqual(["FB-ARUNA", "FB-BRUNB"]);
  });

  it("returns a new array — input is not mutated", () => {
    const input = [
      entry("FB-IDLE-X", { kind: "idle" }),
      entry("FB-RUN-X", { kind: "running", stepLabel: null }),
    ];
    const before = input.map((e) => e.build.buildId);
    sortFleetEntries(input);
    expect(input.map((e) => e.build.buildId)).toEqual(before);
  });
});

describe("FleetRail rendering", () => {
  it("renders the header label with the right counts", () => {
    render(
      <FleetRail
        entries={[]}
        activeBuildId={null}
        cap={3}
        runningCount={1}
        queuedCount={2}
        parkedCount={4}
        isDevEnvironment={false}
        onOpenQueueDrawer={vi.fn()}
        onSelectBuild={vi.fn()}
        onDeleteBuild={vi.fn()}
      />,
    );
    expect(screen.getByTestId("fleet-header-label")).toHaveTextContent("Needs you: 0 · Working: 1 · Waiting: 2 · Parked: 4");
    expect(screen.queryByLabelText("Queued, position 2")).not.toBeInTheDocument();
  });

  it("header has role=status + aria-live=polite for queue-change announcement", () => {
    render(
      <FleetRail
        entries={[]}
        activeBuildId={null}
        cap={3}
        runningCount={1}
        queuedCount={2}
        isDevEnvironment={false}
        onOpenQueueDrawer={vi.fn()}
        onSelectBuild={vi.fn()}
        onDeleteBuild={vi.fn()}
      />,
    );
    // role=status comes from the button element.
    const header = screen.getByRole("status");
    expect(header).toHaveAttribute("aria-live", "polite");
  });

  it("clicking the header invokes onOpenQueueDrawer", () => {
    const onOpenQueueDrawer = vi.fn();
    render(
      <FleetRail
        entries={[]}
        activeBuildId={null}
        cap={3}
        runningCount={1}
        queuedCount={2}
        isDevEnvironment={false}
        onOpenQueueDrawer={onOpenQueueDrawer}
        onSelectBuild={vi.fn()}
        onDeleteBuild={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("status"));
    expect(onOpenQueueDrawer).toHaveBeenCalledTimes(1);
  });

  it("renders a placeholder when there are no entries", () => {
    render(
      <FleetRail
        entries={[]}
        activeBuildId={null}
        cap={3}
        runningCount={0}
        queuedCount={0}
        isDevEnvironment={false}
        onOpenQueueDrawer={vi.fn()}
        onSelectBuild={vi.fn()}
        onDeleteBuild={vi.fn()}
      />,
    );
    expect(screen.getByText(/No builds\./i)).toBeInTheDocument();
  });

  it("propagates onSelectBuild with the right build", () => {
    const onSelectBuild = vi.fn();
    const run = entry("FB-RUNRUN", { kind: "running", stepLabel: null });
    render(
      <FleetRail
        entries={[run]}
        activeBuildId={null}
        cap={3}
        runningCount={1}
        queuedCount={0}
        isDevEnvironment={false}
        onOpenQueueDrawer={vi.fn()}
        onSelectBuild={onSelectBuild}
        onDeleteBuild={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Open build Build FB-RUNRUN"));
    expect(onSelectBuild).toHaveBeenCalledTimes(1);
    expect(onSelectBuild).toHaveBeenCalledWith(run.build);
  });

  it("renders rows in sort order (running first)", () => {
    const idle = entry("FB-IDLEIDL", { kind: "idle" });
    const running = entry("FB-RUNRUN", { kind: "running", stepLabel: null });
    const queued = entry("FB-QQQQ1Q", { kind: "queued", position: 1, reason: "capacity", ahead: 0 });
    render(
      <FleetRail
        entries={[idle, queued, running]}
        activeBuildId={null}
        cap={3}
        runningCount={1}
        queuedCount={1}
        isDevEnvironment={false}
        onOpenQueueDrawer={vi.fn()}
        onSelectBuild={vi.fn()}
        onDeleteBuild={vi.fn()}
      />,
    );
    const rows = Array.from(document.querySelectorAll('[data-density="fleet"]'));
    const ids = rows.map((row) => row.parentElement?.querySelector('button[aria-label^="Open build"]')?.getAttribute("aria-label"));
    expect(ids[0]).toContain("FB-RUNRUN");
    expect(ids[1]).toContain("FB-QQQQ1Q");
    expect(ids[2]).toContain("FB-IDLEIDL");
  });

  it("marks the active row with aria-current=true", () => {
    const a = entry("FB-AAAAAA1", { kind: "idle" });
    const b = entry("FB-BBBBBB2", { kind: "idle" });
    render(
      <FleetRail
        entries={[a, b]}
        activeBuildId="FB-BBBBBB2"
        cap={3}
        runningCount={0}
        queuedCount={0}
        isDevEnvironment={false}
        onOpenQueueDrawer={vi.fn()}
        onSelectBuild={vi.fn()}
        onDeleteBuild={vi.fn()}
      />,
    );
    const activeRows = document.querySelectorAll('[data-density="fleet"][data-active="true"]');
    expect(activeRows.length).toBe(1);
    expect(activeRows[0]).toHaveAttribute("aria-current", "true");
  });
});
