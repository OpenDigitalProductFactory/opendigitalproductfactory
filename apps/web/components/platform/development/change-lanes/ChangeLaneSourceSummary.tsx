import type {
  LaneReadModelFreshness,
  LaneReadModelFreshnessState,
} from "@/lib/contributor-change-lanes/read-model";

import { RefreshContributorInventoryButton } from "./RefreshContributorInventoryButton";

const SOURCE_LABEL: Record<LaneReadModelFreshness["source"], string> = {
  "work-capsule": "Workrooms",
  "runtime-target": "Runtime Targets",
  "runtime-verification": "Runtime Verifications",
  "nonprod-lease": "Non-prod Leases",
  "git-worktree": "Git Worktrees",
  "git-branch": "Git Branches",
  "github-pr": "GitHub PRs",
};

const LIVE_SOURCES: LaneReadModelFreshness["source"][] = [
  "work-capsule",
  "runtime-target",
  "runtime-verification",
  "nonprod-lease",
];

const SNAPSHOT_SOURCES: LaneReadModelFreshness["source"][] = [
  "git-worktree",
  "git-branch",
  "github-pr",
];

export function ChangeLaneSourceSummary({
  freshness,
  isAdmin = false,
}: {
  freshness: LaneReadModelFreshness[];
  isAdmin?: boolean;
}) {
  const byName = new Map(freshness.map((f) => [f.source, f]));
  const live = LIVE_SOURCES.map((s) => byName.get(s)).filter(
    (x): x is LaneReadModelFreshness => Boolean(x),
  );
  const snapshot = SNAPSHOT_SOURCES.map((s) => byName.get(s)).filter(
    (x): x is LaneReadModelFreshness => Boolean(x),
  );

  return (
    <div
      className="rounded border p-3 text-xs"
      style={{
        borderColor: "var(--dpf-border)",
        backgroundColor: "var(--dpf-surface-2)",
      }}
    >
      <div className="mb-2 flex items-center text-[10px] uppercase tracking-wide text-[var(--dpf-muted)]">
        <span>Source freshness</span>
        <RefreshContributorInventoryButton isAdmin={isAdmin} />
      </div>
      <SubGroup label="Live data" rows={live} />
      {live.length > 0 && snapshot.length > 0 ? (
        <div
          className="my-2 h-px"
          style={{ backgroundColor: "var(--dpf-border)" }}
          aria-hidden
        />
      ) : null}
      <SubGroup label="Inventory snapshot" rows={snapshot} />
    </div>
  );
}

function SubGroup({
  label,
  rows,
}: {
  label: string;
  rows: LaneReadModelFreshness[];
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-[10px] text-[var(--dpf-muted)] uppercase tracking-wide">
        {label}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 md:grid-cols-4">
        {rows.map((row) => (
          <FreshnessDot key={row.source} row={row} />
        ))}
      </div>
    </div>
  );
}

function FreshnessDot({ row }: { row: LaneReadModelFreshness }) {
  const dotColor = colorForState(row.state);
  const label = labelForRow(row);
  return (
    <div
      className="flex items-center gap-2"
      aria-label={`${SOURCE_LABEL[row.source]} — ${row.state} (${label})`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          row.state === "warming-up" ? "animate-pulse" : ""
        }`}
        style={{ backgroundColor: `var(${dotColor})` }}
        aria-hidden
      />
      <span className="text-[var(--dpf-text)]">{SOURCE_LABEL[row.source]}</span>
      <span
        className="text-[var(--dpf-muted)]"
        title={row.message ?? undefined}
      >
        {label}
      </span>
    </div>
  );
}

function colorForState(state: LaneReadModelFreshnessState): string {
  switch (state) {
    case "ok":
      return "--dpf-success";
    case "stale":
      return "--dpf-warning";
    case "error":
      return "--dpf-error";
    case "not-configured":
    case "warming-up":
      return "--dpf-muted";
  }
}

function labelForRow(row: LaneReadModelFreshness): string {
  switch (row.state) {
    case "ok":
      return String(row.count);
    case "stale":
      return row.message ?? `${row.count} (stale)`;
    case "error":
      return row.message ?? "error";
    case "not-configured":
      return "not configured";
    case "warming-up":
      return "syncing…";
  }
}
