"use client";

import Link from "next/link";

import { DataTable, StatCard, StatusBadge, type Column } from "@/components/ui/report-kit";
import type { CapsuleLivenessSummary } from "@/lib/work-capsules/liveness-inventory";
import { portfolioRoleLabel } from "@/lib/work-capsules/work-capsule-presenter";

export type WorkroomInventoryRow = {
  capsuleId: string;
  title: string;
  status: string;
  source: string;
  executorKind: string | null;
  portfolioRole: string | null;
  headBranch: string | null;
  pullRequestUrl: string | null;
  updatedAt: string;
  liveness: string;
  isLive: boolean;
  isReapable: boolean;
  livenessReason: string;
  trueLivenessAt: string | null;
};

const columns: Column<WorkroomInventoryRow>[] = [
  {
    key: "workroom",
    header: "Workroom",
    cell: (room) => <div><Link className="font-medium text-[var(--dpf-accent)] hover:underline" href={`/workspace/cases/${room.capsuleId}`}>{room.title}</Link><p className="mt-1 font-mono text-dpf-caption text-[var(--dpf-muted)]">{room.capsuleId}</p></div>,
    sortAccessor: (room) => room.title,
    width: "28%",
  },
  { key: "portfolio", header: "Portfolio", cell: (room) => portfolioRoleLabel(room.portfolioRole), sortAccessor: (room) => portfolioRoleLabel(room.portfolioRole), width: "16%" },
  {
    key: "liveness",
    header: "Liveness",
    cell: (room) => <div><StatusBadge intent={room.isLive ? "success" : room.isReapable ? "warning" : "neutral"} label={room.liveness.replaceAll("-", " ")} uppercase={false} /><p className="mt-1 max-w-xs text-xs text-[var(--dpf-muted)]">{room.livenessReason}</p></div>,
    sortAccessor: (room) => room.liveness,
    width: "24%",
  },
  { key: "executor", header: "Executor", cell: (room) => room.executorKind ?? "Unassigned", sortAccessor: (room) => room.executorKind ?? "", width: "14%" },
  { key: "context", header: "Development context", cell: (room) => room.headBranch ?? "Not a code Workroom", mono: true, width: "18%" },
];

function WorkroomRows({ rows, label }: { rows: WorkroomInventoryRow[]; label: string }) {
  return <DataTable ariaLabel={label} className="overflow-x-auto rounded-xl border border-[var(--dpf-border)]" columns={columns} rows={rows} getRowKey={(room) => room.capsuleId} pageSize={20} empty="No Workrooms in this group. New activity appears here when work is claimed or started." />;
}

function duration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 60 * 60 * 1000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

export function WorkroomInventory({
  workrooms,
  summary,
}: {
  workrooms: WorkroomInventoryRow[];
  summary: CapsuleLivenessSummary;
}) {
  const live = workrooms.filter((room) => room.isLive);
  const history = workrooms.filter((room) => !room.isLive);
  return (
    <div className="space-y-8">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Live" value={summary.live} intent="success" />
        <StatCard label="History" value={`${summary.history} inactive`} />
        <StatCard label="Cleanup" value={summary.reapable} intent={summary.reapable > 0 ? "warning" : "neutral"} />
        <StatCard label="Executing" value={summary.heavyLane.executing} />
        <StatCard label="Ready" value={summary.heavyLane.nextReady} intent={summary.heavyLane.nextReady > 0 ? "info" : "neutral"} />
        <StatCard label="Wait" value={duration(summary.progressSlo.oldestWaitMs)} intent={(summary.progressSlo.oldestWaitMs ?? 0) > 3_600_000 ? "warning" : "neutral"} />
      </div>
      <section className="space-y-3" aria-labelledby="live-workrooms-heading">
        <div>
          <h2 id="live-workrooms-heading" className="text-base font-semibold text-[var(--dpf-text)]">Live Workrooms</h2>
          <p className="text-xs text-[var(--dpf-muted)]">Currently live across the platform.</p>
        </div>
        <WorkroomRows rows={live} label="Live Workrooms" />
      </section>
      <section className="space-y-3" aria-labelledby="history-workrooms-heading">
        <div>
          <h2 id="history-workrooms-heading" className="text-base font-semibold text-[var(--dpf-text)]">History</h2>
          <p className="text-xs text-[var(--dpf-muted)]">Inactive records retained for audit.</p>
        </div>
        <WorkroomRows rows={history} label="Workroom history and cleanup" />
      </section>
    </div>
  );
}
