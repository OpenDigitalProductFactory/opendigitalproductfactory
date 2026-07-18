"use client";

// Consolidated owner-facing proactivity roster (BI-65D622EA). Reuses the shared
// ProactivityLevelControl and the existing saveCoworkerProactivityPreference
// write path — this is the aggregated confirm/adjust surface, not a new engine.

import { useState } from "react";

import { ProactivityLevelControl } from "@/components/proactivity/ProactivityLevelControl";
import { saveCoworkerProactivityPreference } from "@/lib/actions/proactivity";
import type { ProactivityLevel } from "@/lib/proactivity/proactivity-types";
import {
  groupRosterByArea,
  type ProactivityRosterRow,
} from "@/lib/proactivity/proactivity-roster";

type RowState = { level: ProactivityLevel; isOverride: boolean };

export function ProactivityRosterList({ rows }: { rows: ProactivityRosterRow[] }) {
  const [state, setState] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      rows.map((row) => [row.agentId, { level: row.level, isOverride: row.isOverride }]),
    ),
  );

  function change(agentId: string, next: ProactivityLevel) {
    setState((prev) => ({ ...prev, [agentId]: { level: next, isOverride: true } }));
    // Fire-and-forget: the setting persists to a UserFact; a save hiccup must not
    // block the UI. The value re-derives from the server on next load.
    saveCoworkerProactivityPreference(agentId, next).catch(() => {});
  }

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
            {group.rows.map((row) => {
              const current = state[row.agentId] ?? { level: row.level, isOverride: row.isOverride };
              return (
                <li
                  key={row.agentId}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--dpf-text)]">
                      {row.displayName}
                    </p>
                    <p className="truncate text-xs text-[var(--dpf-muted)]">
                      {row.role}
                      {" · "}
                      {current.isOverride ? "You set this" : "From your industry"}
                    </p>
                  </div>
                  <ProactivityLevelControl
                    value={current.level}
                    onChange={(next) => change(row.agentId, next)}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
