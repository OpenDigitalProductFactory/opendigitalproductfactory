// BI-SCHED-TIMELINE / EP-SCHEDULING-SURFACE — daily-schedule visual for the
// Scheduled Jobs admin page. Server component: a read-only projection of the
// canonical scheduling map onto a 24h UTC clock, so an operator can see what
// runs when and where work clusters. Live status + controls stay in the table.

import type { SchedulingMapEntry } from "@/lib/operate/scheduled-jobs/scheduling-map";
import {
  buildTimelineModel,
  type TimelineJob,
} from "@/lib/operate/scheduled-jobs/scheduling-timeline";

const CAT_COLOR: Record<"core" | "editable", string> = {
  core: "#fbbf24",
  editable: "#818cf8",
};

const pad = (n: number) => String(n).padStart(2, "0");

function Chip({ job, showTime }: { job: TimelineJob; showTime?: boolean }) {
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1.5"
      style={{ background: "var(--dpf-bg)", border: "1px solid var(--dpf-border)", color: "var(--dpf-text)" }}
      title={`${job.name} · ${job.label}`}
    >
      <span style={{ width: 6, height: 6, borderRadius: 9999, background: CAT_COLOR[job.category], flexShrink: 0 }} />
      {showTime && <span className="font-mono" style={{ color: "var(--dpf-muted)" }}>{job.label}</span>}
      {job.name}
    </span>
  );
}

function Section({ title, jobs, showTime }: { title: string; jobs: TimelineJob[]; showTime?: boolean }) {
  if (jobs.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="text-[10px] uppercase font-medium mb-1.5" style={{ color: "var(--dpf-muted)" }}>
        {title} ({jobs.length})
      </div>
      <div className="flex flex-wrap gap-1.5">
        {jobs.map((j) => (
          <Chip key={j.id} job={j} showTime={showTime} />
        ))}
      </div>
    </div>
  );
}

export function SchedulingTimeline({ entries }: { entries: readonly SchedulingMapEntry[] }) {
  const model = buildTimelineModel(entries);
  const timed = model.hourBuckets.flatMap((b) => b.jobs);
  const BAR_AREA = 88; // px
  const seg =
    model.maxBucket > 0 ? Math.max(4, Math.min(16, Math.floor(BAR_AREA / model.maxBucket))) : 16;

  return (
    <div className="mt-6 rounded p-4" style={{ border: "1px solid var(--dpf-border)" }}>
      <div className="flex items-baseline justify-between mb-3 gap-4">
        <div>
          <h2 className="text-sm font-bold" style={{ color: "var(--dpf-text)" }}>
            Daily schedule (UTC)
          </h2>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--dpf-muted)" }}>
            Code-defined schedule across all substrates. Hover a bar for the jobs in that hour.
          </p>
        </div>
        <div className="flex gap-3 text-[10px] whitespace-nowrap" style={{ color: "var(--dpf-muted)" }}>
          <span className="inline-flex items-center gap-1">
            <span style={{ width: 8, height: 8, borderRadius: 9999, background: CAT_COLOR.core }} />core
          </span>
          <span className="inline-flex items-center gap-1">
            <span style={{ width: 8, height: 8, borderRadius: 9999, background: CAT_COLOR.editable }} />editable
          </span>
        </div>
      </div>

      {/* 24h bar chart — one column per UTC hour, one segment per timed job */}
      <div className="flex items-end gap-[2px]" style={{ height: BAR_AREA }}>
        {model.hourBuckets.map((b) => (
          <div
            key={b.hour}
            className="flex-1 flex flex-col justify-end items-stretch gap-[2px]"
            title={
              b.jobs.length
                ? b.jobs.map((j) => `${j.label}  ${j.name}`).join("\n")
                : `${pad(b.hour)}:00 — nothing scheduled`
            }
          >
            {b.jobs.map((j) => (
              <div key={j.id} style={{ height: seg, background: CAT_COLOR[j.category], borderRadius: 2 }} />
            ))}
          </div>
        ))}
      </div>
      {/* hour axis */}
      <div className="flex gap-[2px] mt-1">
        {model.hourBuckets.map((b) => (
          <div key={b.hour} className="flex-1 text-center text-[9px]" style={{ color: "var(--dpf-muted)" }}>
            {b.hour % 3 === 0 ? pad(b.hour) : ""}
          </div>
        ))}
      </div>

      <Section title="Timed jobs" jobs={timed} showTime />
      <Section title="Runs continuously" jobs={model.frequent} />
      <Section title="Daily — time set in code" jobs={model.unpinned} />
    </div>
  );
}
