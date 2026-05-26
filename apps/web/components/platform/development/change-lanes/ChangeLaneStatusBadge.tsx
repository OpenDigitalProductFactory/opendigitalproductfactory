import type { ContributorLaneStatus } from "@/lib/contributor-change-lanes/types";

const STATUS_COLOR_CLASSES: Record<ContributorLaneStatus, string> = {
  blocked: "border-[var(--dpf-error)] text-[var(--dpf-error)]",
  starting: "border-[var(--dpf-warning)] text-[var(--dpf-warning)]",
  verifying: "border-[var(--dpf-warning)] text-[var(--dpf-warning)]",
  running: "border-[var(--dpf-accent)] text-[var(--dpf-accent)]",
  "ready-for-review": "border-[var(--dpf-success)] text-[var(--dpf-success)]",
  claimed: "border-[var(--dpf-muted)] text-[var(--dpf-text)]",
  available: "border-[var(--dpf-border)] text-[var(--dpf-muted)]",
  released: "border-[var(--dpf-border)] text-[var(--dpf-muted)]",
  stale: "border-[var(--dpf-warning)] text-[var(--dpf-warning)]",
};

export function ChangeLaneStatusBadge({ status }: { status: ContributorLaneStatus }) {
  const classes = STATUS_COLOR_CLASSES[status];
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${classes}`}
    >
      {status}
    </span>
  );
}
