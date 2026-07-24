"use client";

// Consolidated owner-facing proactivity roster (BI-65D622EA). Reuses the shared
// ProactivityLevelControl and the existing saveCoworkerProactivityPreference
// write path — this is the aggregated confirm/adjust surface, not a new engine.
//
// BI-20716EA4: each row owns its OWN useSaveState instance (keyed by
// `key={row.agentId}`, so a row never leaks status across agents) instead of a
// single fire-and-forget `.catch(() => {})` — a failed save now snaps the
// control back to the last confirmed level and shows Retry/Revert next to
// that exact row.

import { useMemo } from "react";

import { ProactivityLevelControl } from "@/components/proactivity/ProactivityLevelControl";
import { SaveStateIndicator } from "@/components/ui/SaveStateIndicator";
import { saveCoworkerProactivityPreference } from "@/lib/actions/proactivity";
import { useSaveState } from "@/lib/shared/use-save-state";
import type { ProactivityLevel } from "@/lib/proactivity/proactivity-types";
import {
  groupRosterByArea,
  type ProactivityRosterRow,
} from "@/lib/proactivity/proactivity-roster";

type RowState = { level: ProactivityLevel; isOverride: boolean };

function ProactivityRosterRowControl({ row }: { row: ProactivityRosterRow }) {
  // `useSaveState`'s `value` must be referentially stable across renders when
  // unchanged (see the hook's doc comment) — a fresh object literal here would
  // re-trigger its resync effect on every render.
  const value = useMemo<RowState>(
    () => ({ level: row.level, isOverride: row.isOverride }),
    [row.level, row.isOverride],
  );
  const save = useSaveState<RowState>({
    value,
    onSave: (next) => saveCoworkerProactivityPreference(row.agentId, next.level),
    failureMessage: "Couldn't save this proactivity level. Try again.",
  });

  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-[var(--dpf-text)]">{row.displayName}</p>
        <p className="truncate text-xs text-[var(--dpf-muted)]">
          {row.role}
          {" · "}
          {save.value.isOverride ? "You set this" : "From your industry"}
        </p>
        <SaveStateIndicator
          compact
          status={save.status}
          error={save.error}
          onRetry={save.retry}
          onRevert={save.revert}
        />
      </div>
      <ProactivityLevelControl
        value={save.value.level}
        onChange={(next) => save.change({ level: next, isOverride: true })}
      />
    </li>
  );
}

export function ProactivityRosterList({ rows }: { rows: ProactivityRosterRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--dpf-muted)]">No coworkers to configure yet.</p>
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
