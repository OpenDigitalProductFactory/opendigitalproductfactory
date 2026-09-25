"use client";

import Link from "next/link";

import { DataTable, StatusBadge, type Column } from "@/components/ui/report-kit";
import { encodeWorkCaseKey } from "@/lib/work-management/case-key";
import type { HeldWorkroomRow } from "@/lib/work-management/held-workrooms";

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
          <p className="mt-1 font-mono text-dpf-caption text-[var(--dpf-muted)]">{room.capsuleId}</p>
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
      header: "Why",
      cell: (room) => (
        <div>
          <p className="text-sm text-[var(--dpf-text)]">{room.deviationCodes.length > 0 ? room.deviationCodes.join(", ").replaceAll("_", " ") : room.reason.replaceAll("_", " ")}</p>
          {room.stageKey ? <p className="mt-1 text-xs text-[var(--dpf-muted)]">Stage {room.stageKey}</p> : null}
        </div>
      ),
      sortAccessor: (room) => room.reason,
      width: "34%",
    },
    { key: "held", header: "Held for", cell: (room) => held(room.since, now), sortAccessor: (room) => room.since ?? "", width: "12%" },
    {
      key: "owner",
      header: "Owner told",
      cell: (room) => (room.notifiedAt ? "Yes" : room.stuckTicks != null && room.stuckTicks < 4 ? "Not yet" : "No"),
      sortAccessor: (room) => room.notifiedAt ?? "",
      width: "12%",
    },
  ];
  return (
    <DataTable
      ariaLabel="Held Workrooms"
      className="overflow-x-auto rounded-xl border border-[var(--dpf-border)]"
      columns={columns}
      rows={rows}
      getRowKey={(room) => room.capsuleId}
      pageSize={20}
      empty="No Workroom is paused or escalated by its drive."
    />
  );
}
