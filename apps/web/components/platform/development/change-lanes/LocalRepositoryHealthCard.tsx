import { StatusBadge } from "@/components/ui/report-kit";
import type { LaneReadModelFreshness } from "@/lib/contributor-change-lanes/read-model";
import {
  summarizeLocalRepositoryHealth,
  type LocalRepositoryHealthSummary,
} from "@/lib/contributor-change-lanes/local-repository-health";
import type { ContributorChangeLane } from "@/lib/contributor-change-lanes/types";

export function LocalRepositoryHealthCard({
  lanes,
  freshness,
}: {
  lanes: ContributorChangeLane[];
  freshness: LaneReadModelFreshness[];
}) {
  const summary = summarizeLocalRepositoryHealth({ lanes, freshness });

  return (
    <section
      aria-labelledby="local-source-repository-health"
      className="rounded border p-4"
      style={{
        borderColor: "var(--dpf-border)",
        backgroundColor: "var(--dpf-surface-1)",
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="local-source-repository-health"
              className="text-sm font-semibold text-[var(--dpf-text)]"
            >
              Local source repository
            </h2>
            <StatusBadge
              intent={summary.intent}
              label={summary.badgeLabel}
              variant="soft"
            />
          </div>
          <p className="text-sm text-[var(--dpf-text)]">{summary.headline}</p>
          <p className="max-w-3xl text-xs text-[var(--dpf-muted)]">
            This checks the local Git branches and worktrees that protect work before it
            is shared. GitHub PR data is helpful when connected, but the local repository
            check works on its own.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <MiniStat label="Branches" value={summary.gitBranchCount} />
          <MiniStat label="Worktrees" value={summary.gitWorktreeCount} />
          <MiniStat label="Local blockers" value={summary.localBlockerCount} />
          <MiniStat label="Served commit" value={summary.servedCommitShort ?? "—"} mono />
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <SummaryList title="What DPF sees" items={summary.details} />
        <SummaryList title="Next action" items={summary.nextActions} />
      </div>
    </section>
  );
}

function MiniStat({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
}) {
  return (
    <div
      className="rounded border px-3 py-2"
      style={{
        borderColor: "var(--dpf-border)",
        backgroundColor: "var(--dpf-surface-2)",
      }}
    >
      <div className="text-[10px] uppercase tracking-wide text-[var(--dpf-muted)]">
        {label}
      </div>
      <div
        className={[
          "mt-1 text-sm font-semibold text-[var(--dpf-text)]",
          mono ? "font-mono" : "",
        ].join(" ")}
      >
        {value}
      </div>
    </div>
  );
}

function SummaryList({
  title,
  items,
}: {
  title: string;
  items: LocalRepositoryHealthSummary["details"];
}) {
  return (
    <div>
      <h3 className="text-[10px] uppercase tracking-wide text-[var(--dpf-muted)]">
        {title}
      </h3>
      <ul className="mt-1 space-y-1 text-xs text-[var(--dpf-text)]">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="text-[var(--dpf-muted)]" aria-hidden>
              •
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
