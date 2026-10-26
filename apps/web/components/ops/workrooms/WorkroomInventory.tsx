"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { DataTable, StatCard, StatusBadge, type Column } from "@/components/ui/report-kit";
import type { CapsuleLivenessSummary } from "@/lib/work-capsules/liveness-inventory";
import type { InvocationAttribution } from "@/lib/work-capsules/invocation-attribution";
import { countOperatorAttention, projectWorkroomOperatorSummary, type OperatorWorkGroup, type WorkroomOperatorSummary } from "@/lib/work-capsules/workroom-operator-summary";
import { portfolioRoleLabel } from "@/lib/work-capsules/work-capsule-presenter";
import { encodeWorkCaseKey } from "@/lib/work-management/case-key";
import { useT } from "@/lib/i18n/use-t";

/** COO fields stay in row details so the default-visible inventory does not grow. */
export type WorkroomCooFields = {
  lastCycleKey: string | null;
  lastAction: string | null;
  lastReason: string | null;
  ticksSinceAdvance: number | null;
  nextWakeAt: string | null;
  spanOfControl: number;
  overSpan: boolean;
  unowned: boolean;
  paused: boolean;
  ownerIsSuggestion: boolean;
  escalationLabel: string | null;
  missingAckCount: number;
  actionHref: string;
};

export type CooSupervisionSummary = {
  unownedCount: number;
  pausedCount: number;
  overSpanOwners: Array<{ principalId: string; displayName: string | null; roomCount: number }>;
  missingAckCount: number;
};

export type WorkroomInventoryRow = {
  capsuleId: string; backlogItemId: string | null; title: string; status: string;
  source: string; executorKind: string | null; attribution: InvocationAttribution;
  portfolioRole: string | null; headBranch: string | null; pullRequestUrl: string | null;
  updatedAt: string; liveness: string; isLive: boolean; isReapable: boolean;
  livenessReason: string; trueLivenessAt: string | null;
  accountableName?: string | null; operator?: WorkroomOperatorSummary;
  coo?: WorkroomCooFields | null;
};

const viewOf = (room: WorkroomInventoryRow) => room.operator ?? projectWorkroomOperatorSummary(room);
const roomHref = (room: WorkroomInventoryRow) => `/workspace/cases/${encodeWorkCaseKey(room.backlogItemId
  ? { sourceType: "backlog-item", sourceId: room.backlogItemId }
  : { sourceType: "work-capsule", sourceId: room.capsuleId })}`;

function WorkroomRows({ rows, label }: { rows: WorkroomInventoryRow[]; label: string }) {
const t = useT("workrooms");
const columns: Column<WorkroomInventoryRow>[] = [
  { key: "workroom", header: t("inventory.work"), sortAccessor: room => room.title,
    cell: room => <div><Link className="font-medium text-dpf-accent hover:underline" href={roomHref(room)}>{room.title}</Link>
      <p className="mt-1 text-dpf-caption text-dpf-muted">{portfolioRoleLabel(room.portfolioRole)}</p></div> },
  { key: "owner", header: t("inventory.accountable"), cell: room => room.accountableName ?? t("inventory.unassigned") },
  { key: "next", header: t("inventory.next"), cell: room => {
    const view = viewOf(room);
    return <div><StatusBadge intent={view.group === "attention" ? "warning" : view.group === "working" ? "success" : "neutral"}
      label={t(view.label)} uppercase={false} /><p className="mt-1 text-dpf-caption text-dpf-muted">{t(view.nextAction)}</p></div>;
  } },
  { key: "detail", header: t("inventory.details"), cell: room => <details>
    <summary className="cursor-pointer text-dpf-accent">{t("inventory.technical")}</summary>
    <div className="mt-2 max-w-xs space-y-2 break-words text-dpf-caption text-dpf-muted">
      <p>{room.livenessReason}</p><p>{room.attribution.executor} · {room.attribution.invocation}</p>
      <p>{room.capsuleId}</p>{room.headBranch && <p>{room.headBranch}</p>}
      {viewOf(room).recoveryCondition && <p>{t("inventory.recovery", { condition: viewOf(room).recoveryCondition ?? "" })}</p>}
      {room.pullRequestUrl && <Link className="text-dpf-accent hover:underline" href={room.pullRequestUrl}>{t("inventory.change")}</Link>}
      {room.coo && <CooRoomDetails room={room.coo} t={t} />}
    </div>
  </details> },
];

  return <DataTable ariaLabel={label} className="overflow-x-auto rounded-dpf-xl border border-dpf-border"
    columns={columns} rows={rows} getRowKey={room => room.capsuleId} pageSize={20}
    empty={t("inventory.empty")} />;
}

function CooRoomDetails({ room, t }: { room: WorkroomCooFields; t: ReturnType<typeof useT<"workrooms">> }) {
  return <div data-coo-fields className="space-y-2">
    {room.lastCycleKey && <p>{t("coo.lastCycle", { cycle: room.lastCycleKey })}</p>}
    {room.lastAction && <p>{t("coo.lastAction", { action: room.lastAction })}</p>}
    {room.lastReason && <p>{t("coo.lastReason", { reason: room.lastReason })}</p>}
    {room.ticksSinceAdvance != null && <p>{t("coo.ticks", { count: room.ticksSinceAdvance })}</p>}
    <p>{room.nextWakeAt ? t("coo.nextWake", { when: room.nextWakeAt }) : t("coo.nextWakeUnknown")}</p>
    {room.unowned && <p>{t("coo.unownedRoom")}</p>}
    {room.paused && <p>{t("coo.pausedRoom")}</p>}
    {room.ownerIsSuggestion && <p>{t("coo.suggestion")}</p>}
    <p>{t("coo.span", { count: room.spanOfControl })}</p>
    {room.overSpan && <p>{t("coo.overSpanFlag")}</p>}
    {room.escalationLabel && <p>{t("coo.escalation", { path: room.escalationLabel })}</p>}
    {room.missingAckCount > 0 && <p>{t("coo.missingAck", { count: room.missingAckCount })}</p>}
    <Link className="text-dpf-accent hover:underline" href={room.actionHref}>{t("coo.openRoom")}</Link>
  </div>;
}

export function WorkroomInventory({ workrooms, summary, heldCapsuleIds = [], attentionContent, supervision }: {
  workrooms: WorkroomInventoryRow[]; summary: CapsuleLivenessSummary;
  heldCapsuleIds?: string[]; attentionContent?: React.ReactNode;
  supervision?: CooSupervisionSummary | null;
}) {
  const t = useT("workrooms");
  const labels = { attention: t("inventory.attention"), working: t("inventory.working"), waiting: t("inventory.waiting"), history: t("inventory.history") };
  const groups = { attention: [] as WorkroomInventoryRow[], working: [] as WorkroomInventoryRow[],
    waiting: [] as WorkroomInventoryRow[], history: [] as WorkroomInventoryRow[] };
  for (const room of workrooms) groups[viewOf(room).group].push(room);
  const sharedRecoveryIds = attentionContent ? heldCapsuleIds : [];
  const held = new Set(sharedRecoveryIds);
  const attentionCount = countOperatorAttention(groups.attention.map(room => room.capsuleId), sharedRecoveryIds);
  const [selected, setSelected] = useState<OperatorWorkGroup>(attentionCount ? "attention"
    : groups.working.length ? "working" : "waiting");
  const [showHistory, setShowHistory] = useState(false);
  const visibleRows = groups[selected].filter(room => selected !== "attention" || !held.has(room.capsuleId));
  const showRows = selected !== "attention" || visibleRows.length > 0 || !attentionContent;
  return <div className="space-y-6">
    <section className="space-y-3" aria-labelledby="live-workrooms-heading">
      <h2 id="live-workrooms-heading" className="text-dpf-subtitle font-dpf-semibold text-dpf-text">{t("inventory.current")}</h2>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("inventory.views")}>
        {(["attention", "working", "waiting"] as const).map(group => <Button key={group}
          variant={selected === group ? "primary" : "secondary"} aria-pressed={selected === group}
          onClick={() => setSelected(group)}>{labels[group]} · {group === "attention" ? attentionCount : groups[group].length}</Button>)}
      </div>
      {selected === "attention" && attentionContent}
      {showRows && <WorkroomRows key={selected} rows={visibleRows} label={labels[selected]} />}
    </section>
    <details onToggle={event => setShowHistory(event.currentTarget.open)} className="rounded-dpf-xl border border-dpf-border p-4">
      <summary className="cursor-pointer font-dpf-semibold">{t("inventory.historyCount", { count: groups.history.length })}</summary>
      {showHistory && <WorkroomRows rows={groups.history} label={t("inventory.history")} />}
    </details>
    {supervision && <details data-coo-supervision className="rounded-dpf-xl border border-dpf-border p-4">
      <summary className="cursor-pointer font-dpf-semibold">{t("coo.supervision")}</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("coo.unowned")} value={supervision.unownedCount} />
        <StatCard label={t("coo.paused")} value={supervision.pausedCount} />
        <StatCard label={t("coo.overSpan")} value={supervision.overSpanOwners.length} />
        <StatCard label={t("coo.missingAcks")} value={supervision.missingAckCount} />
      </div>
      {supervision.overSpanOwners.length > 0 && <ul className="mt-3 space-y-1 text-dpf-caption text-dpf-muted">
        {supervision.overSpanOwners.map(owner => <li key={owner.principalId}>
          {owner.displayName ?? owner.principalId} · {owner.roomCount}
        </li>)}
      </ul>}
    </details>}
    <details className="rounded-dpf-xl border border-dpf-border p-4">
      <summary className="cursor-pointer font-dpf-semibold">{t("inventory.system")}</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <StatCard label={t("inventory.held")} value={summary.live} />
        <StatCard label={t("inventory.cleanup")} value={summary.reapable} />
        <StatCard label={t("inventory.executing")} value={summary.heavyLane.executing} />
      </div>
    </details>
  </div>;
}
