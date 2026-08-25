import Link from "next/link";

import { EmptyState, StatCard, StatusBadge } from "@/components/ui/report-kit";
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

function WorkroomRows({ rows }: { rows: WorkroomInventoryRow[] }) {
  if (rows.length === 0) {
    return <EmptyState size="sm" title="No Workrooms in this group" description="New activity appears here when work is claimed or started." />;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--dpf-border)]">
      <table className="min-w-full text-sm">
        <thead className="bg-[var(--dpf-surface-2)] text-left text-xs text-[var(--dpf-muted)]">
          <tr>
            <th className="px-3 py-2 font-medium">Workroom</th>
            <th className="px-3 py-2 font-medium">Portfolio</th>
            <th className="px-3 py-2 font-medium">Liveness</th>
            <th className="px-3 py-2 font-medium">Executor</th>
            <th className="px-3 py-2 font-medium">Development context</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          {rows.map((room) => (
            <tr key={room.capsuleId}>
              <td className="px-3 py-3 align-top">
                <Link className="font-medium text-[var(--dpf-accent)] hover:underline" href={`/workspace/cases/${room.capsuleId}`}>
                  {room.title}
                </Link>
                <p className="mt-1 font-mono text-dpf-caption text-[var(--dpf-muted)]">{room.capsuleId}</p>
              </td>
              <td className="px-3 py-3 align-top text-[var(--dpf-text)]">{portfolioRoleLabel(room.portfolioRole)}</td>
              <td className="px-3 py-3 align-top">
                <StatusBadge intent={room.isLive ? "success" : room.isReapable ? "warning" : "neutral"} label={room.liveness.replaceAll("-", " ")} uppercase={false} />
                <p className="mt-1 max-w-xs text-xs text-[var(--dpf-muted)]">{room.livenessReason}</p>
              </td>
              <td className="px-3 py-3 align-top text-[var(--dpf-text)]">{room.executorKind ?? "Unassigned"}</td>
              <td className="px-3 py-3 align-top font-mono text-xs text-[var(--dpf-muted)]">
                {room.headBranch ?? "Not a code Workroom"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Live now" value={`${summary.live} live`} intent="success" hint="Backed by a lease, open PR, or recent activity" />
        <StatCard label="History" value={`${summary.history} inactive`} hint="Terminal, expired, stalled, or awaiting cleanup" />
        <StatCard label="Cleanup candidates" value={summary.reapable} intent={summary.reapable > 0 ? "warning" : "neutral"} hint="Eligible for governed reaping" />
      </div>
      <section className="space-y-3" aria-labelledby="live-workrooms-heading">
        <div>
          <h2 id="live-workrooms-heading" className="text-base font-semibold text-[var(--dpf-text)]">Live now</h2>
          <p className="text-xs text-[var(--dpf-muted)]">Every running Workroom, regardless of where it was started.</p>
        </div>
        <WorkroomRows rows={live} />
      </section>
      <section className="space-y-3" aria-labelledby="history-workrooms-heading">
        <div>
          <h2 id="history-workrooms-heading" className="text-base font-semibold text-[var(--dpf-text)]">History and cleanup</h2>
          <p className="text-xs text-[var(--dpf-muted)]">Stored records are retained without being mislabeled as active work.</p>
        </div>
        <WorkroomRows rows={history} />
      </section>
    </div>
  );
}
