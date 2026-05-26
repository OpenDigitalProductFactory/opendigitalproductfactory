import type { LaneReadModelFreshness } from "@/lib/contributor-change-lanes/read-model";

const SOURCE_LABEL: Record<LaneReadModelFreshness["source"], string> = {
  "work-capsule": "Work Capsules",
  "runtime-target": "Runtime Targets",
  "runtime-verification": "Runtime Verifications",
  "nonprod-lease": "Non-prod Leases",
  "git-worktree": "Git Worktrees",
  "git-branch": "Git Branches",
  "github-pr": "GitHub PRs",
};

export function ChangeLaneSourceSummary({ freshness }: { freshness: LaneReadModelFreshness[] }) {
  return (
    <div
      className="rounded border p-3 text-xs"
      style={{
        borderColor: "var(--dpf-border)",
        backgroundColor: "var(--dpf-surface-2)",
      }}
    >
      <div className="mb-2 text-[var(--dpf-muted)] uppercase tracking-wide text-[10px]">
        Source freshness
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 md:grid-cols-4">
        {freshness.map((f) => (
          <div key={f.source} className="flex items-center gap-2">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                f.ok ? "bg-[var(--dpf-success)]" : "bg-[var(--dpf-error)]"
              }`}
              aria-hidden
            />
            <span className="text-[var(--dpf-text)]">{SOURCE_LABEL[f.source]}</span>
            <span className="text-[var(--dpf-muted)]">
              {f.ok ? f.count : f.error ?? "error"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
