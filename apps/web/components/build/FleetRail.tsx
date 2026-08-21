// apps/web/components/build/FleetRail.tsx
//
// The compact left rail of the redesigned Build Studio shell. Shows the
// operator focus queue as <=32px rows plus a header that separates work needing
// the human, work the AI Coworker is doing, queued work, and parked work.
//
// Per the spec §1 (Fleet Rail) and the queue surface amendment (PR #898):
//   - Header: "Needs you: N · Working: N · Waiting: N · Parked: N",
//     role=status, aria-live="polite" so queue changes are announced.
//   - Default sort: needs-attention -> running -> blocked -> queued -> idle.
//   - Each row uses BuildListItem density="fleet".
//   - Clicking the header invokes onOpenQueueDrawer (the BuildStudio shell
//     opens the DetailsDrawer scrolled to the BS-Queue subsection).

"use client";

import type { FeatureBuildRow } from "@/lib/feature-build-types";

import {
  BUILD_STUDIO_TEST_IDS,
  getFleetRailBodyClassName,
  getFleetRailClassName,
  getFleetRailHeaderClassName,
} from "./build-studio-layout";
import { BuildListItem } from "./BuildListItem";
import {
  formatFleetHeader as formatFleetHeaderLabel,
  formatOperatorFocusHeader,
} from "./fleet-derivation";
import type { BuildQueueState } from "./QueueStateBadge";
import type { BuildAttention } from "@/lib/build/build-attention";

/** Each visible entry: the FeatureBuildRow plus per-row queue/attention state. */
export type FleetRailEntry = {
  build: FeatureBuildRow;
  lifecycleLabel: string | null;
  queueState: BuildQueueState;
  attention: BuildAttention | null;
};

export type FleetRailProps = {
  /** All visible builds. Sort order is determined HERE by queueState.kind,
   *  not by the caller — the caller passes raw entries. */
  entries: readonly FleetRailEntry[];
  /** buildId of the currently-selected build (for active-row styling). */
  activeBuildId: string | null;
  /** Concurrency cap from the BS runtime. */
  cap: number;
  /** Count of running builds (derived from entries — passed in so the runtime
   *  thread owns the source of truth, not this component). */
  runningCount: number;
  /** Count of queued builds (same provenance as runningCount). */
  queuedCount: number;
  /** Count of quiet builds held by AI Coworker outside the operator focus list. */
  parkedCount?: number;
  /** Build Studio is hidden/disabled in dev environments — passed through to
   *  BuildListItem so the delete button respects that state. */
  isDevEnvironment: boolean;
  /** Click handler for the FleetRail header — opens the BS-Queue drawer subsection. */
  onOpenQueueDrawer: () => void;
  /** Per-build click handler — the BuildStudio shell uses this to set the active build. */
  onSelectBuild: (build: FeatureBuildRow) => void;
  /** Per-build delete handler. */
  onDeleteBuild: (build: FeatureBuildRow) => void;
};

/** Sort priority — needs-attention first, then running, blocked, queued, idle.
 *  Pure: callers can rely on the same input producing the same render order. */
export function sortFleetEntries(entries: readonly FleetRailEntry[]): FleetRailEntry[] {
  const kindRank: Record<BuildQueueState["kind"], number> = {
    running: 0,
    blocked: 1,
    queued: 2,
    idle: 3,
  };
  return [...entries].sort((a, b) => {
    const aNeeds = a.attention?.needsOwner ?? false;
    const bNeeds = b.attention?.needsOwner ?? false;
    if (aNeeds !== bNeeds) return aNeeds ? -1 : 1;
    const ra = kindRank[a.queueState.kind];
    const rb = kindRank[b.queueState.kind];
    if (ra !== rb) return ra - rb;
    if (a.queueState.kind === "queued" && b.queueState.kind === "queued") {
      return a.queueState.position - b.queueState.position;
    }
    // Same rank, non-queued: stable by buildId for determinism.
    return a.build.buildId.localeCompare(b.build.buildId);
  });
}

/** Formats the header label. Pinned as a helper so tests can assert it. */
export function formatFleetHeader(runningCount: number, cap: number, queuedCount: number): string {
  return formatFleetHeaderLabel(runningCount, cap, queuedCount);
}

export function FleetRail({
  entries,
  activeBuildId,
  runningCount,
  queuedCount,
  parkedCount = 0,
  isDevEnvironment,
  onOpenQueueDrawer,
  onSelectBuild,
  onDeleteBuild,
}: FleetRailProps) {
  const sorted = sortFleetEntries(entries);
  const needsYouCount = entries.filter((entry) => entry.attention?.needsOwner).length;
  const blockedCount = entries.filter((entry) =>
    !entry.attention?.needsOwner && entry.queueState.kind === "blocked",
  ).length;
  const headerLabel = formatOperatorFocusHeader({
    needsYouCount,
    workingCount: runningCount,
    blockedCount,
    queuedCount,
    parkedCount,
  });
  return (
    <aside
      data-testid={BUILD_STUDIO_TEST_IDS.fleet}
      aria-label="Build fleet"
      className={getFleetRailClassName()}
    >
      <button
        type="button"
        onClick={onOpenQueueDrawer}
        data-testid={BUILD_STUDIO_TEST_IDS.fleetHeader}
        role="status"
        aria-live="polite"
        aria-label={`Open queue details — ${headerLabel}`}
        className={[
          getFleetRailHeaderClassName(),
          "cursor-pointer",
          "hover:text-[var(--dpf-accent)]",
          "focus-visible:outline-2",
          "focus-visible:outline-offset-2",
          "focus-visible:outline-[var(--dpf-accent)]",
        ].join(" ")}
      >
        <span data-testid="fleet-header-label" className="inline-flex min-w-0 items-center gap-1">
          {headerLabel}
        </span>
        <span aria-hidden="true" className="text-[var(--dpf-muted)]">
          ›
        </span>
      </button>

      <ul className={getFleetRailBodyClassName()} data-testid="fleet-rail-body">
        {sorted.length === 0 && (
          <li className="px-3 py-2 text-[11px] text-[var(--dpf-muted)]">No builds.</li>
        )}
        {sorted.map((entry, index) => (
          <li key={entry.build.buildId}>
            <BuildListItem
              build={entry.build}
              active={activeBuildId === entry.build.buildId}
              index={index}
              lifecycleLabel={entry.lifecycleLabel}
              isDevEnvironment={isDevEnvironment}
              density="fleet"
              queueState={entry.queueState}
              attention={entry.attention}
              onSelect={() => onSelectBuild(entry.build)}
              onDelete={() => onDeleteBuild(entry.build)}
            />
          </li>
        ))}
      </ul>
    </aside>
  );
}
