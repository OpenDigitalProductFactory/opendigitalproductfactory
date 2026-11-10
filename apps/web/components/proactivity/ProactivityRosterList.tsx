"use client";

// Owner-facing proactivity roster (BI-65D622EA), now READ-ONLY.
//
// BI-87C9C91C moved proactivity ownership from the coworker to the
// outcome-specific Workroom, so this surface no longer writes. It answers one
// question — what each coworker does when it is working outside any room — and
// offers no control, because a control here would set a property that no longer
// exists on a coworker.

import { getProactivityLevelCopy } from "@/lib/proactivity/proactivity-copy";
import {
  groupRosterByArea,
  type ProactivityRosterRow,
} from "@/lib/proactivity/proactivity-roster";

// BI-87C9C91C — this row used to SET a proactivity level on a coworker. That
// ownership moved to the outcome-specific Workroom, so the row is now a
// read-only projection: what this coworker does when it is working outside any
// room. It is kept rather than deleted because "what happens with no room" is a
// real question, and answering it is not the same as offering to change it.
function ProactivityRosterRowControl({ row }: { row: ProactivityRosterRow }) {
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-[var(--dpf-text)]">{row.displayName}</p>
        <p className="truncate text-xs text-[var(--dpf-muted)]">{row.role}</p>
      </div>
      <p className="shrink-0 text-xs text-[var(--dpf-muted)]">
        {getProactivityLevelCopy(row.level).label}
      </p>
    </li>
  );
}

export function ProactivityRosterList({ rows }: { rows: ProactivityRosterRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--dpf-muted)]">No coworkers yet.</p>
    );
  }

  const groups = groupRosterByArea(rows);

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.area.key}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--dpf-muted)]">
            {group.area.label}
            <span className="ml-1.5 font-normal normal-case">({group.rows.length})</span>
          </h2>
          <ul className="divide-y divide-[var(--dpf-border)] rounded-lg border border-[var(--dpf-border)]">
            {group.rows.map((row) => (
              <ProactivityRosterRowControl key={row.agentId} row={row} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
