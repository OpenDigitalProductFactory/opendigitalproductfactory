"use client";

import Link from "next/link";

import { DataTable, StatusBadge, type Column } from "@/components/ui/report-kit";
import { encodeWorkCaseKey } from "@/lib/work-management/case-key";
import type { HeldWorkroomRow } from "@/lib/work-management/held-workrooms";
import { useT } from "@/lib/i18n/use-t";

/** How long ago, in the unit a person reads at a glance. */
function held(since: string | null, now: number): string {
  if (!since) return "Unknown";
  const ms = now - Date.parse(since);
  if (!Number.isFinite(ms) || ms < 0) return "Just now";
  if (ms < 60 * 60 * 1000) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (ms < 48 * 60 * 60 * 1000) return `${Math.round(ms / 3_600_000)} h`;
  return `${Math.round(ms / 86_400_000)} days`;
}

export function HeldWorkroomsList({ rows, nowIso }: { rows: HeldWorkroomRow[]; nowIso: string }) {
  const t = useT("workrooms");
  const now = Date.parse(nowIso);
  const columns: Column<HeldWorkroomRow>[] = [
    {
      key: "workroom",
      header: "Workroom",
      cell: (room) => (
        <div>
          <Link className="font-medium text-[var(--dpf-accent)] hover:underline"
            href={`/workspace/cases/${encodeWorkCaseKey({ sourceType: "work-capsule", sourceId: room.capsuleId })}`}>
            {room.title}
          </Link>
        </div>
      ),
      sortAccessor: (room) => room.title,
      width: "30%",
    },
    {
      key: "state",
      header: "State",
      cell: (room) => <StatusBadge intent={room.action === "escalate" ? "danger" : "warning"} label={room.action === "escalate" ? "escalated" : "paused"} uppercase={false} />,
      sortAccessor: (room) => room.action,
      width: "12%",
    },
    {
      key: "why",
      header: t("inventory.next"),
      cell: (room) => (
        <div>
          {room.nextAction && <p className="text-dpf-body text-dpf-text">{t(room.nextAction.actor)} · {t(room.nextAction.instruction)}</p>}
          {room.recoveryCondition && <p className="mt-1 text-dpf-caption text-dpf-muted">{room.recoveryCondition}</p>}
          <details><summary className="cursor-pointer text-dpf-caption text-dpf-accent">{t("inventory.technical")}</summary>
            <p className="text-dpf-caption text-dpf-muted">{room.deviationCodes.length > 0 ? room.deviationCodes.join(", ").replaceAll("_", " ") : room.reason.replaceAll("_", " ")}</p>
            {room.stageKey ? <p className="text-dpf-caption text-dpf-muted">{t("inventory.stage", { stage: room.stageKey })}</p> : null}</details>
        </div>
      ),
      sortAccessor: (room) => room.reason,
      width: "34%",
    },
    { key: "held", header: "Held for", cell: (room) => held(room.since, now), sortAccessor: (room) => room.since ?? "", width: "12%" },
    {
      key: "owner",
      header: "Accountable",
      cell: (room) => room.accountableName ?? "Not assigned",
      sortAccessor: (room) => room.notifiedAt ?? "",
      width: "12%",
    },
  ];
  const groups = new Map<string, HeldWorkroomRow[]>();
  for (const room of rows) {
    const key = [room.action, room.reason, ...room.deviationCodes].join("|");
    groups.set(key, [...(groups.get(key) ?? []), room]);
  }
  if (!rows.length) return <p className="text-dpf-body text-dpf-muted">None.</p>;
  return <div className="space-y-3">{[...groups].map(([key, rooms]) => {
    const first = rooms[0]!;
    const shared = first.nextAction && rooms.every(room => room.nextAction?.actor === first.nextAction!.actor
      && room.nextAction?.instruction === first.nextAction!.instruction && room.nextAction?.detail === first.nextAction!.detail)
      ? first.nextAction : null;
    const sharedCondition = first.recoveryCondition && rooms.every(room => room.recoveryCondition === first.recoveryCondition)
      ? first.recoveryCondition : null;
    return <details key={key} className="rounded-dpf-md border border-dpf-border p-3">
    <summary className="cursor-pointer font-dpf-semibold">
      {rooms[0]!.reason === "executor_writeback_unavailable" ? "Stage results were not recorded" : rooms[0]!.reason.replaceAll("_", " ")}
      {" · "}{rooms.length} {rooms.length === 1 ? "room" : "rooms"}
      <span className="mt-1 block text-dpf-caption font-normal text-dpf-muted">{shared
        ? <>{t(shared.actor)} · {shared.detail ?? t(shared.instruction)}</> : t("inventory.action.groupVaries")}</span>
    </summary>
    {rooms[0]!.reason === "executor_writeback_unavailable"
      && <p className="my-3 text-dpf-body text-dpf-muted">{t("inventory.action.writebackBoundary")}</p>}
    {sharedCondition && <p className="mb-3 text-dpf-caption text-dpf-muted">{t("inventory.recovery", { condition: sharedCondition })}</p>}
    <DataTable
      ariaLabel="Held Workrooms"
      className="overflow-x-auto rounded-xl border border-[var(--dpf-border)]"
      columns={columns}
      rows={rooms}
      getRowKey={(room) => room.capsuleId}
      pageSize={20}
      empty="No Workroom is paused or escalated by its drive."
    />
  </details>;
  })}</div>;
}
