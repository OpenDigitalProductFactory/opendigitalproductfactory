"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { DataTable, StatCard, StatusBadge, type Column } from "@/components/ui/report-kit";
import type { CapsuleLivenessSummary } from "@/lib/work-capsules/liveness-inventory";
import type { InvocationAttribution } from "@/lib/work-capsules/invocation-attribution";
import { projectWorkroomOperatorSummary, type OperatorWorkGroup, type WorkroomOperatorSummary } from "@/lib/work-capsules/workroom-operator-summary";
import { portfolioRoleLabel } from "@/lib/work-capsules/work-capsule-presenter";
import { encodeWorkCaseKey } from "@/lib/work-management/case-key";

export type WorkroomInventoryRow = {
  capsuleId: string; backlogItemId: string | null; title: string; status: string;
  source: string; executorKind: string | null; attribution: InvocationAttribution;
  portfolioRole: string | null; headBranch: string | null; pullRequestUrl: string | null;
  updatedAt: string; liveness: string; isLive: boolean; isReapable: boolean;
  livenessReason: string; trueLivenessAt: string | null;
  accountableName?: string | null; operator?: WorkroomOperatorSummary;
};

const labels = { attention: "Needs attention", working: "Working now", waiting: "Waiting", history: "History" };
const viewOf = (room: WorkroomInventoryRow) => room.operator ?? projectWorkroomOperatorSummary(room);
const roomHref = (room: WorkroomInventoryRow) => `/workspace/cases/${encodeWorkCaseKey(room.backlogItemId
  ? { sourceType: "backlog-item", sourceId: room.backlogItemId }
  : { sourceType: "work-capsule", sourceId: room.capsuleId })}`;

const columns: Column<WorkroomInventoryRow>[] = [
  { key: "workroom", header: "Work", sortAccessor: room => room.title,
    cell: room => <div><Link className="font-medium text-dpf-accent hover:underline" href={roomHref(room)}>{room.title}</Link>
      <p className="mt-1 text-dpf-caption text-dpf-muted">{portfolioRoleLabel(room.portfolioRole)}</p></div> },
  { key: "owner", header: "Accountable", cell: room => room.accountableName ?? "Not assigned" },
  { key: "next", header: "Next step", cell: room => {
    const view = viewOf(room);
    return <div><StatusBadge intent={view.group === "attention" ? "warning" : view.group === "working" ? "success" : "neutral"}
      label={view.label} uppercase={false} /><p className="mt-1 text-dpf-caption text-dpf-muted">{view.nextAction}</p></div>;
  } },
  { key: "detail", header: "Details", cell: room => <details>
    <summary className="cursor-pointer text-dpf-accent">Technical evidence</summary>
    <div className="mt-2 max-w-xs space-y-2 break-words text-dpf-caption text-dpf-muted">
      <p>{room.livenessReason}</p><p>{room.attribution.executor} · {room.attribution.invocation}</p>
      <p>{room.capsuleId}</p>{room.headBranch && <p>{room.headBranch}</p>}
      {viewOf(room).recoveryCondition && <p>Recovery condition: {viewOf(room).recoveryCondition}</p>}
      {room.pullRequestUrl && <Link className="text-dpf-accent hover:underline" href={room.pullRequestUrl}>Open change</Link>}
    </div>
  </details> },
];

function WorkroomRows({ rows, label }: { rows: WorkroomInventoryRow[]; label: string }) {
  return <DataTable ariaLabel={label} className="overflow-x-auto rounded-dpf-xl border border-dpf-border"
    columns={columns} rows={rows} getRowKey={room => room.capsuleId} pageSize={20}
    empty="Nothing in this view. Choose another work view." />;
}

export function WorkroomInventory({ workrooms, summary, heldCapsuleIds = [], attentionContent }: {
  workrooms: WorkroomInventoryRow[]; summary: CapsuleLivenessSummary;
  heldCapsuleIds?: string[]; attentionContent?: React.ReactNode;
}) {
  const groups = { attention: [] as WorkroomInventoryRow[], working: [] as WorkroomInventoryRow[],
    waiting: [] as WorkroomInventoryRow[], history: [] as WorkroomInventoryRow[] };
  for (const room of workrooms) groups[viewOf(room).group].push(room);
  const held = new Set(heldCapsuleIds);
  const attentionCount = new Set([...groups.attention.map(room => room.capsuleId), ...heldCapsuleIds]).size;
  const [selected, setSelected] = useState<OperatorWorkGroup>(attentionCount ? "attention"
    : groups.working.length ? "working" : "waiting");
  const [showHistory, setShowHistory] = useState(false);
  const visibleRows = groups[selected].filter(room => selected !== "attention" || !held.has(room.capsuleId));
  const showRows = selected !== "attention" || visibleRows.length > 0 || !attentionContent;
  return <div className="space-y-6">
    <section className="space-y-3" aria-labelledby="live-workrooms-heading">
      <h2 id="live-workrooms-heading" className="text-dpf-subtitle font-dpf-semibold text-dpf-text">Current work</h2>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Work views">
        {(["attention", "working", "waiting"] as const).map(group => <Button key={group}
          variant={selected === group ? "primary" : "secondary"} aria-pressed={selected === group}
          onClick={() => setSelected(group)}>{labels[group]} · {group === "attention" ? attentionCount : groups[group].length}</Button>)}
      </div>
      {selected === "attention" && attentionContent}
      {showRows && <WorkroomRows key={selected} rows={visibleRows} label={labels[selected]} />}
    </section>
    <details onToggle={event => setShowHistory(event.currentTarget.open)} className="rounded-dpf-xl border border-dpf-border p-4">
      <summary className="cursor-pointer font-dpf-semibold">History · {groups.history.length} retained rooms</summary>
      {showHistory && <WorkroomRows rows={groups.history} label="History" />}
    </details>
    <details className="rounded-dpf-xl border border-dpf-border p-4">
      <summary className="cursor-pointer font-dpf-semibold">System details</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <StatCard label="Held" value={summary.live} />
        <StatCard label="Cleanup" value={summary.reapable} />
        <StatCard label="Executing" value={summary.heavyLane.executing} />
      </div>
    </details>
  </div>;
}
