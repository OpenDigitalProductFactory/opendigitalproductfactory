// apps/web/components/build/FleetRail.tsx
//
// The compact left rail of the redesigned Build Studio shell. Shows every
// in-flight build as a ≤32px row plus a header that surfaces the BS queue
// runtime state (concurrency cap + running + queued counts).
//
// Per the spec §1 (Fleet Rail) and the queue surface amendment (PR #898):
//   - Header: "Builds: {running}/{cap} · {queuedCount} queued", role=status,
//     aria-live="polite" so cap/queue-position changes are announced.
//   - Default sort: running → blocked → queued (by position) → idle.
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
import type { BuildQueueState } from "./QueueStateBadge";

/** Each visible entry: the FeatureBuildRow plus per-row queue/attention state. */
export type FleetRailEntry = {
  build: FeatureBuildRow;
  lifecycleLabel: string | null;
  queueState: BuildQueueState;
  needsAttention: boolean;
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

/** Sort priority — running first, then blocked, then queued (by position ascending), then idle.
 *  Pure: callers can rely on the same input producing the same render order. */
export function sortFleetEntries(entries: readonly FleetRailEntry[]): FleetRailEntry[] {
  const kindRank: Record<BuildQueueState["kind"], number> = {
    running: 0,
    blocked: 1,
    queued: 2,
    idle: 3,
  };
  return [...entries].sort((a, b) => {
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
  return `Builds: ${runningCount}/${cap} · ${queuedCount} queued`;
}

export function FleetRail({
  entries,
  activeBuildId,
  cap,
  runningCount,
  queuedCount,
  isDevEnvironment,
  onOpenQueueDrawer,
  onSelectBuild,
  onDeleteBuild,
}: FleetRailProps) {
  const sorted = sortFleetEntries(entries);
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
        aria-label={`Open queue details — ${formatFleetHeader(runningCount, cap, queuedCount)}`}
        className={[
          getFleetRailHeaderClassName(),
          "cursor-pointer",
          "hover:text-[var(--dpf-accent)]",
          "focus-visible:outline-2",
          "focus-visible:outline-offset-2",
          "focus-visible:outline-[var(--dpf-accent)]",
        ].join(" ")}
      >
        <span data-testid="fleet-header-label">
          {formatFleetHeader(runningCount, cap, queuedCount)}
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
              needsAttention={entry.needsAttention}
              onSelect={() => onSelectBuild(entry.build)}
              onDelete={() => onDeleteBuild(entry.build)}
            />
          </li>
        ))}
      </ul>
    </aside>
  );
}
