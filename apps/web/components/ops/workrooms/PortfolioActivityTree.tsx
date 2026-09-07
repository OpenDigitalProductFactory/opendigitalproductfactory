"use client";

import Link from "next/link";
import { useState } from "react";

import { LiveActivityDot } from "@/components/ui/LiveActivityDot";

import type {
  ActivitySignalState,
  BranchRow,
  RepresentativeActivity,
} from "@/lib/work-management/portfolio-activity-projection";

/**
 * A branch row with its label already resolved.
 *
 * The label is resolved on the server and passed as data, not as a formatter.
 * This is a client component, and a function cannot cross the server/client
 * boundary — passing one renders on its own in a unit test and fails in the app.
 */
export type BranchRowView = BranchRow & { label: string };

/**
 * The compact activity tree (PWA-01, PWA-02, PWA-06).
 *
 * Three interaction rules the design is explicit about, and each is easy to get
 * wrong:
 *
 * Expansion and selection are independent. The chevron discloses a branch's
 * rooms; it does not change what the inspector is showing. Selecting an activity
 * does not collapse or reorder anything. Conflating them makes an operator lose
 * their place every time they look at something.
 *
 * Every row is one click from its detail. A representative activity carries the
 * destination of the room it describes, so a summary never requires expanding
 * ancestors first to reach the thing it is summarising.
 *
 * A symbol says what the evidence supports. State is decided server-side by
 * `deriveActivitySignal`; this renders it, with an accessible name on every
 * symbol so colour and motion never carry meaning alone. Only `executing`
 * animates, and `motion-reduce:animate-none` stills it for reduced motion.
 */

const SIGNAL_GLYPH: Record<ActivitySignalState, string> = {
  executing: "●",
  "waiting-on-person": "◆",
  queued: "◦",
  blocked: "▲",
  completed: "✓",
  stale: "◌",
  unknown: "?",
};

const SIGNAL_TONE: Record<ActivitySignalState, string> = {
  executing: "text-[var(--dpf-accent)]",
  "waiting-on-person": "text-[var(--dpf-warning)]",
  queued: "text-[var(--dpf-muted)]",
  blocked: "text-[var(--dpf-danger)]",
  completed: "text-[var(--dpf-success)]",
  stale: "text-[var(--dpf-muted)]",
  unknown: "text-[var(--dpf-muted)]",
};

export function ActivitySymbol({ state, label }: { state: ActivitySignalState; label: string }) {
  // Only `executing` is live. Every other state renders the same primitive
  // without motion, so the glyph and its accessible name still carry the meaning.
  return (
    <LiveActivityDot
      label={label}
      glyph={SIGNAL_GLYPH[state]}
      live={state === "executing"}
      className={SIGNAL_TONE[state]}
    />
  );
}

function ActivityLine({
  activity,
  selectedRoomId,
}: {
  activity: RepresentativeActivity;
  selectedRoomId: string | null;
}) {
  const selected = selectedRoomId === activity.roomId;
  return (
    <li className="flex items-start gap-2 py-1">
      <ActivitySymbol state={activity.signal.state} label={activity.signal.label} />
      <Link
        href={activity.href}
        aria-current={selected ? "true" : undefined}
        className={`min-h-11 text-sm hover:underline ${
          selected ? "font-medium text-[var(--dpf-text)]" : "text-[var(--dpf-accent)]"
        }`}
      >
        {activity.statement}
      </Link>
    </li>
  );
}

export function PortfolioActivityTree({
  rows,
  partial,
  selectedRoomId = null,
}: {
  rows: readonly BranchRowView[];
  /** True when more branches exist than this page carries. */
  partial: boolean;
  selectedRoomId?: string | null;
}) {
  // Expansion is view state and deliberately separate from selection.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  if (rows.length === 0) {
    return <p className="text-sm text-[var(--dpf-muted)]">No activity to show.</p>;
  }

  return (
    <div>
      <ul className="divide-y divide-[var(--dpf-border)]">
        {rows.map((row) => {
          const isOpen = expanded.has(row.branchId);
          return (
            <li key={row.branchId} className="py-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? "Collapse" : "Expand"} ${row.label}`}
                  onClick={() =>
                    setExpanded((current) => {
                      const next = new Set(current);
                      if (next.has(row.branchId)) next.delete(row.branchId);
                      else next.add(row.branchId);
                      return next;
                    })
                  }
                  className="min-h-11 min-w-11 text-sm text-[var(--dpf-muted)]"
                >
                  {isOpen ? "▾" : "▸"}
                </button>
                <span className="text-sm font-medium text-[var(--dpf-text)]">
                  {row.label}
                </span>
                {/* A count supplements the statements below; it never replaces them. */}
                <span className="text-xs text-[var(--dpf-muted)]">
                  {row.roomCount} room{row.roomCount === 1 ? "" : "s"}
                  {row.attentionCount > 0 ? ` · ${row.attentionCount} need attention` : ""}
                </span>
              </div>

              <ul className="ml-11 mt-1">
                {row.representative.map((activity) => (
                  <ActivityLine
                    key={activity.roomId}
                    activity={activity}
                    selectedRoomId={selectedRoomId}
                  />
                ))}
              </ul>

            </li>
          );
        })}
      </ul>
      {partial ? (
        <p className="mt-3 text-xs text-[var(--dpf-muted)]">Partial read: more branches exist.</p>
      ) : null}
    </div>
  );
}
