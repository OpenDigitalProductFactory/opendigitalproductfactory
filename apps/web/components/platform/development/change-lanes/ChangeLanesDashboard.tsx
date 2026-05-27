"use client";

import { useMemo, useState } from "react";

import type { LaneReadModelFreshness } from "@/lib/contributor-change-lanes/read-model";
import type { ContributorChangeLane } from "@/lib/contributor-change-lanes/types";

import { ChangeLaneSourceSummary } from "./ChangeLaneSourceSummary";
import { ChangeLaneTable } from "./ChangeLaneTable";

const TABS = [
  { id: "active", label: "Active lanes" },
  { id: "handoff", label: "Branches needing handoff" },
  { id: "worktrees", label: "Orphan worktrees" },
  { id: "leases", label: "Stale leases" },
  { id: "cleanup", label: "Merged branches safe to delete" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const ACTIVE_STATUSES = new Set([
  "running",
  "verifying",
  "starting",
  "ready-for-review",
  "blocked",
  "claimed",
  "available",
]);

const STALE_STATUSES = new Set(["stale", "released"]);

export function ChangeLanesDashboard({
  lanes,
  freshness,
  generatedAt,
  anySourceWarmingUp = false,
  anySnapshotSourceDegraded = false,
  isAdmin = false,
}: {
  lanes: ContributorChangeLane[];
  freshness: LaneReadModelFreshness[];
  generatedAt: string;
  anySourceWarmingUp?: boolean;
  anySnapshotSourceDegraded?: boolean;
  isAdmin?: boolean;
}) {
  const [tab, setTab] = useState<TabId>("active");

  const filteredLanes = useMemo(() => filterLanes(lanes, tab), [lanes, tab]);

  const githubFresh = freshness.find((f) => f.source === "github-pr");
  const githubNotConfigured = githubFresh?.state === "not-configured";

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-[var(--dpf-text)]">
          Contributor change lanes
        </h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          Branches, worktrees, runtimes, and PRs joined into one view so contributor
          handoff state is visible — read-only for this slice.
        </p>
        <p className="text-[10px] text-[var(--dpf-muted)]">
          Snapshot at {generatedAt}
        </p>
      </header>

      <ChangeLaneSourceSummary freshness={freshness} isAdmin={isAdmin} />

      <div
        className="flex flex-wrap gap-1 border-b text-xs"
        style={{ borderColor: "var(--dpf-border)" }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={[
              "rounded-t px-3 py-1.5 font-medium transition-colors",
              tab === t.id
                ? "border-b-2 border-[var(--dpf-accent)] text-[var(--dpf-text)]"
                : "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
            ].join(" ")}
          >
            {t.label}
            <span className="ml-1 text-[10px] text-[var(--dpf-muted)]">
              {countLanes(lanes, t.id)}
            </span>
            {anySnapshotSourceDegraded ? (
              <span
                className="ml-1 cursor-help text-[10px] text-[var(--dpf-warning)]"
                title="Counts may be incomplete — some inventory sources are not synced."
                aria-label="counts may be incomplete"
              >
                (?)
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <ChangeLaneTable
        lanes={filteredLanes}
        anySourceWarmingUp={anySourceWarmingUp}
        githubNotConfigured={githubNotConfigured}
      />
    </div>
  );
}

function filterLanes(
  lanes: ContributorChangeLane[],
  tab: TabId,
): ContributorChangeLane[] {
  switch (tab) {
    case "active":
      return lanes.filter((l) => ACTIVE_STATUSES.has(l.status));
    case "handoff":
      return lanes.filter(
        (l) =>
          l.source === "git-branch" ||
          (l.source === "work-capsule" &&
            !l.pullRequestUrl &&
            l.blockers.some((b) => /WIP TTL|expired|no branch/i.test(b))),
      );
    case "worktrees":
      return lanes.filter((l) => l.source === "worktree");
    case "leases":
      return lanes.filter(
        (l) =>
          l.source === "nonprod-lease" ||
          (STALE_STATUSES.has(l.status) && l.source === "runtime-target"),
      );
    case "cleanup":
      return lanes.filter(
        (l) =>
          l.source === "git-branch" &&
          l.blockers.some((b) => /no Work Capsule/i.test(b)),
      );
    default:
      return lanes;
  }
}

function countLanes(lanes: ContributorChangeLane[], tab: TabId): number {
  return filterLanes(lanes, tab).length;
}
