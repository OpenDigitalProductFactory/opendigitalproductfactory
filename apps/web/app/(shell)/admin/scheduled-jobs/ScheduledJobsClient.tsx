"use client";

// EP-SCHEDULING-SURFACE — the scheduled-work register (client).
//
// The predecessor rendered one flat, unfiltered table in which a spent one-off,
// a GPU slot-lock and an hourly platform cron were visually identical, no row
// said which coworker was behind it, and the only control was a cadence dropdown
// that defaulted to "Hourly" whatever the job actually ran at.
//
// Organised the way an operator reads it: what needs attention, then what is
// going to run, then the register split into lanes by what the work IS.

import { useMemo, useState, useTransition } from "react";

import {
  listScheduledJobsAction,
  retireJobAction,
  retireSpentJobsAction,
  runJobNowAction,
  setJobEnabledAction,
  updateJobScheduleAction,
} from "@/lib/actions/scheduled-jobs";
import type { MutationResult } from "@/lib/operate/scheduled-jobs/cadence";
import type { WindowRange } from "@/lib/operate/scheduled-jobs/schedule-window";
import type {
  ScheduledWorkView,
  WorkHealth,
} from "@/lib/operate/scheduled-jobs/work-model";
import { getErrorMessage } from "@/lib/shared/get-error-message";

import { EditScheduleDialog } from "./EditScheduleDialog";
import { ScheduleWindowChart } from "./ScheduleWindowChart";

type Banner = { kind: "ok" | "error"; text: string } | null;

/** Lanes group by what the work IS, which is the distinction the flat table
 *  could not make and the reason the page read as a junk drawer. */
type Lane = "coworker" | "platform" | "spent";

const LANE_LABEL: Record<Lane, string> = {
  coworker: "Coworker work",
  platform: "Platform crons",
  spent: "Spent & run-slots",
};

const LANE_BLURB: Record<Lane, string> = {
  coworker: "A coworker on a cadence. The route is where its output lands.",
  platform: "Platform crons. Core-locked ones are read-only.",
  spent: "Already fired, or never a schedule. Retire to clear.",
};

function laneOf(job: ScheduledWorkView): Lane {
  if (job.kind !== "recurring") return "spent";
  return job.substrate === "agent-task" ? "coworker" : "platform";
}

const HEALTH_PILL: Record<WorkHealth, { bg: string; color: string; label: string }> = {
  ok: { bg: "var(--dpf-state-success)", color: "var(--dpf-success)", label: "OK" },
  error: { bg: "var(--dpf-state-error)", color: "var(--dpf-error)", label: "ERROR" },
  overdue: { bg: "var(--dpf-state-warning)", color: "var(--dpf-warning)", label: "OVERDUE" },
  never: { bg: "var(--dpf-surface-3)", color: "var(--dpf-muted)", label: "NEVER RUN" },
  untracked: { bg: "var(--dpf-surface-3)", color: "var(--dpf-muted)", label: "NO REPORTING" },
  spent: { bg: "var(--dpf-surface-3)", color: "var(--dpf-muted)", label: "SPENT" },
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relative(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60000);
  if (mins < 1) return diffMs >= 0 ? "just now" : "in <1m";
  if (mins < 60) return diffMs >= 0 ? `${mins}m ago` : `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return diffMs >= 0 ? `${hrs}h ago` : `in ${hrs}h`;
  const days = Math.round(hrs / 24);
  return diffMs >= 0 ? `${days}d ago` : `in ${days}d`;
}

function Pill({
  children,
  bg,
  color,
  title,
}: {
  children: React.ReactNode;
  bg: string;
  color: string;
  title?: string;
}) {
  return (
    <span
      className="text-dpf-caption font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
      style={{ background: bg, color }}
      title={title}
    >
      {children}
    </span>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`text-left px-3 py-2 text-dpf-caption uppercase font-medium ${className ?? ""}`}
      style={{ color: "var(--dpf-muted)" }}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-2 align-top ${className ?? ""}`} style={{ color: "var(--dpf-text)" }}>
      {children}
    </td>
  );
}

/** Health states that mean "an operator should look at this".
 *  "untracked" is deliberately absent: a cron with tracksRunData:false reports
 *  nothing by design, and counting those made the strip read 51 when 3 were
 *  real. An attention count nobody believes is worse than none. */
const ATTENTION: WorkHealth[] = ["error", "overdue", "never"];

export function ScheduledJobsClient({ initialJobs }: { initialJobs: ScheduledWorkView[] }) {
  const [jobs, setJobs] = useState<ScheduledWorkView[]>(initialJobs);
  const [banner, setBanner] = useState<Banner>(null);
  const [pendingJob, setPendingJob] = useState<string | null>(null);
  const [editJob, setEditJob] = useState<ScheduledWorkView | null>(null);
  const [range, setRange] = useState<WindowRange>("day");
  const [query, setQuery] = useState("");
  const [lane, setLane] = useState<Lane | "all">("all");
  const [healthFilter, setHealthFilter] = useState<WorkHealth | "attention" | "all">("all");
  const [, startTransition] = useTransition();

  async function refresh() {
    setJobs(await listScheduledJobsAction());
  }

  function run(jobId: string, fn: () => Promise<MutationResult>) {
    setPendingJob(jobId);
    setBanner(null);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.ok) {
          setBanner({ kind: "ok", text: res.data });
          await refresh();
        } else {
          setBanner({ kind: "error", text: res.error });
        }
      } catch (err) {
        setBanner({ kind: "error", text: getErrorMessage(err) });
      } finally {
        setPendingJob(null);
      }
    });
  }

  const attention = useMemo(
    () => jobs.filter((j) => ATTENTION.includes(j.health) || j.projectionStale),
    [jobs],
  );
  const spent = useMemo(() => jobs.filter((j) => j.retirable), [jobs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs
      .filter((j) => (lane === "all" ? true : laneOf(j) === lane))
      .filter((j) => {
        if (healthFilter === "all") return true;
        if (healthFilter === "attention") {
          return ATTENTION.includes(j.health) || j.projectionStale;
        }
        return j.health === healthFilter;
      })
      .filter((j) => {
        if (!q) return true;
        // Everything an operator might type: name, id, purpose, cadence, the
        // coworker behind it and the route its output lands on. The old table
        // buried purpose and id in a `hidden` div, so even browser find missed it.
        return [
          j.name,
          j.jobId,
          j.purpose,
          j.cadence,
          j.inngestId ?? "",
          j.agent?.agentId ?? "",
          j.agent?.routeContext ?? "",
          j.agent?.taskTitle ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);
      });
  }, [jobs, lane, healthFilter, query]);

  const lanes: Lane[] = ["coworker", "platform", "spent"];
  const grouped = lanes
    .map((l) => ({ lane: l, rows: filtered.filter((j) => laneOf(j) === l) }))
    .filter((g) => g.rows.length > 0);

  // Soonest first — "what happens next" is the question the register answers.
  for (const g of grouped) {
    g.rows.sort((a, b) => {
      if (a.nextRunAt && b.nextRunAt) return a.nextRunAt.localeCompare(b.nextRunAt);
      if (a.nextRunAt) return -1;
      if (b.nextRunAt) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  function chip(active: boolean) {
    return {
      background: active ? "var(--dpf-accent)" : "transparent",
      color: active ? "var(--dpf-on-accent)" : "var(--dpf-text)",
      border: "1px solid var(--dpf-border)",
    };
  }

  return (
    <div className="mt-6">
      {/* ── What needs attention ─────────────────────────────────────────── */}
      <div
        className="rounded p-3 flex items-center gap-4 flex-wrap text-xs"
        style={{ border: "1px solid var(--dpf-border)" }}
      >
        {attention.length === 0 ? (
          <span style={{ color: "var(--dpf-success)" }}>
            Nothing needs attention.
          </span>
        ) : (
          <>
            <button
              onClick={() => {
                setHealthFilter("attention");
                setLane("all");
              }}
              className="font-medium underline underline-offset-2"
              style={{ color: "var(--dpf-warning)" }}
            >
              {attention.length} need{attention.length === 1 ? "s" : ""} attention
            </button>
            {(["error", "overdue", "never"] as WorkHealth[]).map((h) => {
              const n = jobs.filter((j) => j.health === h).length;
              if (n === 0) return null;
              return (
                <button key={h} onClick={() => setHealthFilter(h)} style={{ color: HEALTH_PILL[h].color }}>
                  {n} {HEALTH_PILL[h].label.toLowerCase()}
                </button>
              );
            })}
            {jobs.some((j) => j.projectionStale) && (
              <span style={{ color: "var(--dpf-muted)" }}>
                {jobs.filter((j) => j.projectionStale).length} with a stale next run
              </span>
            )}
          </>
        )}
        {spent.length > 0 && (
          <span className="ml-auto flex items-center gap-2">
            <span style={{ color: "var(--dpf-muted)" }}>
              {spent.length} spent
            </span>
            <button
              onClick={() =>
                run("__bulk__", () => retireSpentJobsAction(spent.map((j) => j.jobId)))
              }
              disabled={pendingJob === "__bulk__"}
              className="px-2 py-1 rounded"
              style={{ border: "1px solid var(--dpf-border)", color: "var(--dpf-text)" }}
            >
              {pendingJob === "__bulk__" ? "…" : "Retire all"}
            </button>
          </span>
        )}
      </div>

      <ScheduleWindowChart
        jobs={jobs}
        range={range}
        onRangeChange={setRange}
        onPickJob={(jobId) => {
          setQuery(jobId);
          setLane("all");
          setHealthFilter("all");
        }}
      />

      {banner && (
        <div
          className="mt-4 px-3 py-2 rounded text-sm"
          style={{
            background:
              banner.kind === "ok" ? "var(--dpf-state-success)" : "var(--dpf-state-error)",
            color: banner.kind === "ok" ? "var(--dpf-success)" : "var(--dpf-error)",
            border: `1px solid ${banner.kind === "ok" ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)"}`,
          }}
        >
          {banner.text}
        </div>
      )}

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="mt-6 flex items-center gap-2 flex-wrap text-xs">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search jobs, coworkers, routes…"
          className="px-3 py-1.5 rounded w-72 max-w-full"
          style={{
            background: "var(--dpf-bg)",
            color: "var(--dpf-text)",
            border: "1px solid var(--dpf-border)",
          }}
        />
        <div className="inline-flex rounded overflow-hidden" style={{ border: "1px solid var(--dpf-border)" }}>
          <button onClick={() => setLane("all")} className="px-2.5 py-1.5" style={chip(lane === "all")}>
            All ({jobs.length})
          </button>
          {lanes.map((l) => (
            <button key={l} onClick={() => setLane(l)} className="px-2.5 py-1.5" style={chip(lane === l)}>
              {LANE_LABEL[l]} ({jobs.filter((j) => laneOf(j) === l).length})
            </button>
          ))}
        </div>
        <select
          value={healthFilter}
          onChange={(e) => setHealthFilter(e.target.value as WorkHealth | "attention" | "all")}
          className="px-2 py-1.5 rounded"
          style={{
            background: "var(--dpf-bg)",
            color: "var(--dpf-text)",
            border: "1px solid var(--dpf-border)",
          }}
        >
          <option value="all">Any health</option>
          <option value="attention">Needs attention</option>
          <option value="ok">OK</option>
          <option value="error">Error</option>
          <option value="overdue">Overdue</option>
          <option value="never">Never run</option>
          <option value="untracked">No reporting</option>
          <option value="spent">Spent</option>
        </select>
        {(query || lane !== "all" || healthFilter !== "all") && (
          <button
            onClick={() => {
              setQuery("");
              setLane("all");
              setHealthFilter("all");
            }}
            className="px-2 py-1.5 rounded"
            style={{ border: "1px solid var(--dpf-border)", color: "var(--dpf-muted)" }}
          >
            Clear
          </button>
        )}
        <span className="ml-auto" style={{ color: "var(--dpf-muted)" }}>
          Showing {filtered.length} of {jobs.length}
        </span>
      </div>

      {/* ── Register ─────────────────────────────────────────────────────── */}
      {grouped.length === 0 && (
        <div
          className="mt-4 rounded p-6 text-center text-sm"
          style={{ border: "1px solid var(--dpf-border)", color: "var(--dpf-muted)" }}
        >
          Nothing matches these filters.
        </div>
      )}

      {grouped.map(({ lane: l, rows }) => (
        <div key={l} className="mt-6">
          <div className="mb-2">
            <h2 className="text-sm font-bold" style={{ color: "var(--dpf-text)" }}>
              {LANE_LABEL[l]} ({rows.length})
            </h2>
            <p className="text-dpf-caption mt-0.5" style={{ color: "var(--dpf-muted)" }}>
              {LANE_BLURB[l]}
            </p>
          </div>
          <div style={{ border: "1px solid var(--dpf-border)" }} className="rounded overflow-x-auto">
            <table className="w-full text-xs">
              <thead style={{ background: "var(--dpf-bg)" }}>
                <tr>
                  <Th>What it is</Th>
                  {l === "coworker" ? <Th>Coworker · proactivity · lands on</Th> : <Th>Classification</Th>}
                  <Th>Cadence</Th>
                  <Th>Last run</Th>
                  <Th>{l === "spent" ? "Status" : "Next run"}</Th>
                  <Th>Health</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((job) => {
                  const busy = pendingJob === job.jobId;
                  return (
                    <tr
                      key={job.jobId}
                      id={`scheduled-job-${job.jobId}`}
                      className="scroll-mt-24"
                      style={{ borderTop: "1px solid var(--dpf-border)" }}
                    >
                      <Td>
                        <div className="font-medium flex items-center gap-2 flex-wrap">
                          {job.name}
                          {!job.enabled && job.kind === "recurring" && (
                            <Pill bg="var(--dpf-state-error)" color="var(--dpf-error)">
                              DISABLED
                            </Pill>
                          )}
                        </div>
                        {job.purpose && (
                          <div
                            className="text-dpf-caption mt-0.5 max-w-lg"
                            style={{ color: "var(--dpf-muted)" }}
                          >
                            {job.purpose}
                          </div>
                        )}
                        <div className="text-dpf-caption mt-0.5 font-mono" style={{ color: "var(--dpf-muted)" }}>
                          {job.jobId}
                        </div>
                      </Td>
                      <Td>
                        {l === "coworker" && job.agent ? (
                          <>
                            <div>{job.agent.agentId}</div>
                            <a
                              href={job.agent.routeContext}
                              className="text-dpf-caption font-mono underline underline-offset-2"
                              style={{ color: "var(--dpf-accent)" }}
                            >
                              {job.agent.routeContext}
                            </a>
                            {job.agent.proactivity && (
                              <div className="text-dpf-caption mt-0.5" style={{ color: "var(--dpf-muted)" }}>
                                <span style={{ color: "var(--dpf-text)" }}>
                                  {job.agent.proactivity.level}
                                </span>
                                {job.agent.proactivity.registeredCadence
                                  ? ` — self-task runs ${job.agent.proactivity.level === "assertive"
                                      ? job.agent.proactivity.registeredCadence.assertive
                                      : job.agent.proactivity.registeredCadence.balanced}`
                                  : " — does not set this cadence"}
                                {job.agent.proactivity.source === "reconcile-backfill" && " (inferred)"}
                              </div>
                            )}
                            {job.agent.lastTaskRunId && (
                              <div className="text-dpf-caption mt-0.5" style={{ color: "var(--dpf-muted)" }}>
                                last run {job.agent.lastTaskRunId}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="flex flex-col gap-1 items-start">
                            <Pill
                              bg={
                                job.category === "core"
                                  ? "var(--dpf-state-warning)"
                                  : "var(--dpf-accent-soft)"
                              }
                              color={job.category === "core" ? "var(--dpf-warning)" : "var(--dpf-accent)"}
                            >
                              {job.category === "core" ? "🔒 CORE-LOCKED" : "EDITABLE"}
                            </Pill>
                            {job.substrate === "unregistered" && (
                              <Pill
                                bg="var(--dpf-surface-3)"
                                color="var(--dpf-muted)"
                                title="Nothing in code claims this row."
                              >
                                UNREGISTERED
                              </Pill>
                            )}
                          </div>
                        )}
                      </Td>
                      <Td>
                        <div>{job.cadence}</div>
                        <div className="text-dpf-caption font-mono mt-0.5" style={{ color: "var(--dpf-muted)" }}>
                          {job.schedule}
                        </div>
                        {job.substrate === "inngest-cron" && job.inCatalog && (
                          <div className="text-dpf-caption mt-0.5" style={{ color: "var(--dpf-muted)" }}>
                            cron set in code
                          </div>
                        )}
                      </Td>
                      <Td>
                        <div>{job.reportsRunData ? relative(job.lastRunAt) : "not reported"}</div>
                        {job.reportsRunData ? (
                          <div className="text-dpf-caption" style={{ color: "var(--dpf-muted)" }}>
                            {formatTimestamp(job.lastRunAt)}
                          </div>
                        ) : (
                          <div className="text-dpf-caption" style={{ color: "var(--dpf-muted)" }}>
                            records no run data
                          </div>
                        )}
                        {job.lastError && (
                          <div className="text-dpf-caption mt-0.5 max-w-xs" style={{ color: "var(--dpf-error)" }}>
                            {job.lastError.slice(0, 120)}
                          </div>
                        )}
                      </Td>
                      <Td>
                        {job.kind === "recurring" && !job.reportsRunData ? (
                          <div style={{ color: "var(--dpf-muted)" }}>on its cron</div>
                        ) : job.kind === "recurring" ? (
                          <>
                            <div>{relative(job.nextRunAt)}</div>
                            <div className="text-dpf-caption" style={{ color: "var(--dpf-muted)" }}>
                              {formatTimestamp(job.nextRunAt)}
                            </div>
                            {job.projectionStale && (
                              <div
                                className="text-dpf-caption mt-0.5"
                                style={{ color: "var(--dpf-warning)" }}
                                title="Stored next run does not match the cadence."
                              >
                                stale
                              </div>
                            )}
                          </>
                        ) : (
                          <div style={{ color: "var(--dpf-muted)" }}>
                            {job.kind === "slot-lock" ? "run slot" : "fired once"}
                          </div>
                        )}
                      </Td>
                      <Td>
                        <Pill {...HEALTH_PILL[job.health]}>{HEALTH_PILL[job.health].label}</Pill>
                        {job.health === "overdue" && (
                          <div className="text-dpf-caption mt-0.5" style={{ color: "var(--dpf-warning)" }}>
                            {relative(job.nextRunAt)}
                          </div>
                        )}
                      </Td>
                      <Td className="text-right whitespace-nowrap">
                        <div className="inline-flex gap-2 items-center">
                          {job.canRunNow && (
                            <button
                              onClick={() => run(job.jobId, () => runJobNowAction(job.jobId))}
                              disabled={busy}
                              className="px-2 py-1 rounded"
                              style={{ background: "var(--dpf-accent)", color: "var(--dpf-on-accent)" }}
                            >
                              {busy ? "…" : "Run now"}
                            </button>
                          )}
                          {job.scheduleEditable && (
                            <>
                              <button
                                onClick={() => setEditJob(job)}
                                disabled={busy}
                                className="px-2 py-1 rounded"
                                style={{ border: "1px solid var(--dpf-border)", color: "var(--dpf-text)" }}
                              >
                                Edit
                              </button>
                              {job.killSwitchEnforced ? (
                                <button
                                  onClick={() =>
                                    run(job.jobId, () => setJobEnabledAction(job.jobId, !job.enabled))
                                  }
                                  disabled={busy}
                                  className="px-2 py-1 rounded"
                                  style={{ border: "1px solid var(--dpf-border)", color: "var(--dpf-text)" }}
                                >
                                  {job.enabled ? "Disable" : "Enable"}
                                </button>
                              ) : (
                                <span
                                  className="text-dpf-caption"
                                  style={{ color: "var(--dpf-muted)" }}
                                  title="This cron ignores the enabled column; disabling would not stop it."
                                >
                                  no kill switch
                                </span>
                              )}
                            </>
                          )}
                          {job.retirable && (
                            <button
                              onClick={() => run(job.jobId, () => retireJobAction(job.jobId))}
                              disabled={busy}
                              className="px-2 py-1 rounded"
                              style={{ border: "1px solid var(--dpf-border)", color: "var(--dpf-muted)" }}
                            >
                              {busy ? "…" : "Retire"}
                            </button>
                          )}
                          {job.locked && (
                            <span className="text-dpf-caption" style={{ color: "var(--dpf-muted)" }}>
                              read-only
                            </span>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {editJob && (
        <EditScheduleDialog
          job={editJob}
          onClose={() => setEditJob(null)}
          onSave={(schedule) => {
            const jobId = editJob.jobId;
            setEditJob(null);
            run(jobId, () => updateJobScheduleAction(jobId, schedule));
          }}
        />
      )}
    </div>
  );
}
