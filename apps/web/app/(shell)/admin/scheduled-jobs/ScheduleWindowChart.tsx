"use client";

// EP-SCHEDULING-SURFACE — forward schedule chart.
//
// Replaces the fixed 24-hour projection of a static in-code map. Range is
// operator-chosen (day / week / month) and the data is the LIVE register, so a
// weekly sweep and a monthly reconcile are finally visible somewhere.

import { useMemo } from "react";

import {
  buildScheduleWindow,
  WINDOW_LABELS,
  type WindowRange,
} from "@/lib/operate/scheduled-jobs/schedule-window";
import type { ScheduledWorkView } from "@/lib/operate/scheduled-jobs/work-model";

const AGENT_COLOR = "var(--dpf-accent)";
const CRON_COLOR = "var(--dpf-warning)";

const RANGES: WindowRange[] = ["day", "week", "month"];
const RANGE_LABEL: Record<WindowRange, string> = { day: "Day", week: "Week", month: "Month" };

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function List({
  title,
  items,
  onPick,
}: {
  title: string;
  items: { jobId: string; name: string; cadence: string; isAgent: boolean }[];
  onPick: (jobId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="text-dpf-caption uppercase font-medium mb-1.5" style={{ color: "var(--dpf-muted)" }}>
        {title} ({items.length})
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((j) => (
          <button
            key={j.jobId}
            onClick={() => onPick(j.jobId)}
            title={`${j.name} · ${j.cadence}`}
            className="text-dpf-caption px-1.5 py-0.5 rounded inline-flex items-center gap-1.5"
            style={{
              background: "var(--dpf-bg)",
              border: "1px solid var(--dpf-border)",
              color: "var(--dpf-text)",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 9999,
                background: j.isAgent ? AGENT_COLOR : CRON_COLOR,
                flexShrink: 0,
              }}
            />
            {j.name}
            <span style={{ color: "var(--dpf-muted)" }}>{j.cadence}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ScheduleWindowChart({
  jobs,
  range,
  onRangeChange,
  onPickJob,
}: {
  jobs: ScheduledWorkView[];
  range: WindowRange;
  onRangeChange: (r: WindowRange) => void;
  onPickJob: (jobId: string) => void;
}) {
  const model = useMemo(() => buildScheduleWindow(jobs, range), [jobs, range]);

  const BAR_AREA = 96;
  // Segment height must let the TALLEST column fit inside BAR_AREA, gaps
  // included. Flooring it at a comfortable minimum overflowed the column
  // upward — on the month range a busy day carries ~40 fires, and the bars
  // rendered on top of the heading and the range toggle.
  const GAP = 1;
  const seg =
    model.peak > 0
      ? Math.max(1, Math.min(18, Math.floor((BAR_AREA - (model.peak - 1) * GAP) / model.peak)))
      : 18;
  const total = model.buckets.reduce((n, b) => n + b.occurrences.length, 0);

  return (
    <div className="mt-6 rounded p-4" style={{ border: "1px solid var(--dpf-border)" }}>
      <div className="flex items-baseline justify-between mb-3 gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-bold" style={{ color: "var(--dpf-text)" }}>
            What is going to run — {WINDOW_LABELS[range].toLowerCase()}
          </h2>
          <p className="text-dpf-caption mt-0.5" style={{ color: "var(--dpf-muted)" }}>
            {total} scheduled fire{total === 1 ? "" : "s"} projected from live cadences. Hover a bar
            for the jobs in that slot; click a name to filter the register below.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-3 text-dpf-caption whitespace-nowrap" style={{ color: "var(--dpf-muted)" }}>
            <span className="inline-flex items-center gap-1">
              <span style={{ width: 8, height: 8, borderRadius: 9999, background: AGENT_COLOR }} />
              coworker
            </span>
            <span className="inline-flex items-center gap-1">
              <span style={{ width: 8, height: 8, borderRadius: 9999, background: CRON_COLOR }} />
              platform cron
            </span>
          </div>
          <div className="inline-flex rounded overflow-hidden" style={{ border: "1px solid var(--dpf-border)" }}>
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => onRangeChange(r)}
                className="px-2.5 py-1 text-dpf-caption"
                style={{
                  background: r === range ? "var(--dpf-accent)" : "transparent",
                  color: r === range ? "var(--dpf-on-accent)" : "var(--dpf-text)",
                }}
              >
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-end gap-px overflow-hidden" style={{ height: BAR_AREA }}>
        {model.buckets.map((b) => (
          <div
            key={b.startsAt}
            className="flex-1 flex flex-col justify-end items-stretch gap-px"
            title={
              b.occurrences.length
                ? b.occurrences.map((o) => `${timeOf(o.at)}  ${o.name}`).join("\n")
                : `${b.label} — nothing scheduled`
            }
          >
            {b.occurrences.map((o, i) => (
              <div
                key={`${o.jobId}-${i}`}
                style={{
                  height: seg,
                  background: o.isAgent ? AGENT_COLOR : CRON_COLOR,
                  borderRadius: 2,
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex gap-px mt-1">
        {model.buckets.map((b, i) => (
          <div
            key={b.startsAt}
            className="flex-1 text-center text-dpf-caption truncate"
            style={{ color: "var(--dpf-muted)" }}
          >
            {range === "day" ? (i % 3 === 0 ? b.label : "") : i % 2 === 0 ? b.label : ""}
          </div>
        ))}
      </div>

      <List title="Runs continuously — too frequent to plot" items={model.continuous} onPick={onPickJob} />
      <List title="Enabled, but no fire inside this window" items={model.quiet} onPick={onPickJob} />
    </div>
  );
}
