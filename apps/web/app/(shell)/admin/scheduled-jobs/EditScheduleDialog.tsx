"use client";

// EP-SCHEDULING-SURFACE — cadence editor.
//
// The predecessor opened on "Hourly" for every job whose stored cadence was not
// one of eight named tokens — most of the register. Saving from that state
// silently retuned a ten-minute job to hourly.
//
// This opens on what the job ACTUALLY runs at, previews the next fire before you
// commit, and only offers cadences the job's substrate can honour.

import { useMemo, useState } from "react";

import {
  AGENT_RETUNABLE_TOKENS,
  isSupportedCron,
  projectNextRun,
  retuneCron,
} from "@/lib/operate/scheduled-jobs/cadence";
import { describeSchedule } from "@/lib/operate/scheduled-jobs/work-model";
import type { ScheduledWorkView } from "@/lib/operate/scheduled-jobs/work-model";

const ALL_PRESETS: { value: string; label: string }[] = [
  { value: "every-1m", label: "Every minute" },
  { value: "every-5m", label: "Every 5 minutes" },
  { value: "every-15m", label: "Every 15 minutes" },
  { value: "every-30m", label: "Every 30 minutes" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

type Mode = "preset" | "cron";

export function EditScheduleDialog({
  job,
  onClose,
  onSave,
}: {
  job: ScheduledWorkView;
  onClose: () => void;
  onSave: (schedule: string) => void;
}) {
  const isAgent = job.substrate === "agent-task";
  const currentIsCron = isSupportedCron(job.schedule);

  // Open on the truth: a cron-scheduled job opens in cron mode showing its own
  // expression, not on a preset it does not use.
  const [mode, setMode] = useState<Mode>(currentIsCron ? "cron" : "preset");
  const [preset, setPreset] = useState<string>(
    currentIsCron ? (isAgent ? "daily" : "hourly") : job.schedule,
  );
  const [cron, setCron] = useState<string>(currentIsCron ? job.schedule : "0 9 * * *");

  const presets = isAgent
    ? ALL_PRESETS.filter((p) => (AGENT_RETUNABLE_TOKENS as readonly string[]).includes(p.value))
    : ALL_PRESETS;

  /** What will actually be persisted, resolved exactly as the server resolves it. */
  const resolved = useMemo<{ schedule: string | null; why: string | null }>(() => {
    if (mode === "cron") {
      if (!isSupportedCron(cron)) {
        return { schedule: null, why: "Needs 5 fields: minute hour day month weekday." };
      }
      return { schedule: cron, why: null };
    }
    if (!isAgent) return { schedule: preset, why: null };
    const translated = retuneCron(job.schedule, preset);
    if (!translated) {
      return {
        schedule: null,
        why: "Coworker work cannot run more than once a day.",
      };
    }
    return { schedule: translated, why: null };
  }, [mode, cron, preset, isAgent, job.schedule]);

  const nextFire = resolved.schedule ? projectNextRun(resolved.schedule, new Date()) : null;
  const unchanged = resolved.schedule === job.schedule;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      style={{ background: "color-mix(in srgb, var(--dpf-text) 55%, transparent)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[560px] max-w-full max-h-full overflow-y-auto rounded p-6"
        style={{ background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)" }}
      >
        <h2 className="text-lg font-bold" style={{ color: "var(--dpf-text)" }}>
          Edit cadence — {job.name}
        </h2>

        <div
          className="mt-3 rounded p-3 text-xs"
          style={{ background: "var(--dpf-bg)", border: "1px solid var(--dpf-border)" }}
        >
          <div className="flex justify-between gap-4">
            <span style={{ color: "var(--dpf-muted)" }}>Runs at</span>
            <span style={{ color: "var(--dpf-text)" }}>
              {job.cadence} <span className="font-mono" style={{ color: "var(--dpf-muted)" }}>({job.schedule})</span>
            </span>
          </div>
          <div className="flex justify-between gap-4 mt-1">
            <span style={{ color: "var(--dpf-muted)" }}>Runs on</span>
            <span style={{ color: "var(--dpf-text)" }}>
              {isAgent
                ? `${job.agent?.agentId ?? "coworker"} · agent dispatcher`
                : "Inngest cron"}
            </span>
          </div>
          {isAgent && (
            <p className="mt-2" style={{ color: "var(--dpf-muted)" }}>
              Writes the coworker&apos;s own task, so the change takes effect. Presets keep
              the time of day.
            </p>
          )}
          {!isAgent && job.inCatalog && (
            <p className="mt-2" style={{ color: "var(--dpf-muted)" }}>
              The live trigger is set in code. Saving updates the next run, not the cron.
            </p>
          )}
        </div>

        <div className="inline-flex rounded overflow-hidden mt-4" style={{ border: "1px solid var(--dpf-border)" }}>
          {(["preset", "cron"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="px-3 py-1.5 text-xs"
              style={{
                background: mode === m ? "var(--dpf-accent)" : "transparent",
                color: mode === m ? "var(--dpf-on-accent)" : "var(--dpf-text)",
              }}
            >
              {m === "preset" ? "Frequency" : "Cron expression"}
            </button>
          ))}
        </div>

        {mode === "preset" ? (
          <>
            <label
              htmlFor="edit-schedule-frequency"
              className="block text-xs mt-4 mb-1"
              style={{ color: "var(--dpf-muted)" }}
            >
              Frequency
            </label>
            <select
              id="edit-schedule-frequency"
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
              className="w-full px-3 py-2 rounded text-sm"
              style={{
                background: "var(--dpf-bg)",
                color: "var(--dpf-text)",
                border: "1px solid var(--dpf-border)",
              }}
            >
              {presets.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {isAgent && (
              <p className="text-dpf-caption mt-1.5" style={{ color: "var(--dpf-muted)" }}>
                The dispatcher cannot run coworker work more than once a day. Use a cron
                expression for a specific time.
              </p>
            )}
          </>
        ) : (
          <>
            <label
              htmlFor="edit-schedule-cron"
              className="block text-xs mt-4 mb-1"
              style={{ color: "var(--dpf-muted)" }}
            >
              Cron — minute hour day month weekday
            </label>
            <input
              id="edit-schedule-cron"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              spellCheck={false}
              className="w-full px-3 py-2 rounded text-sm font-mono"
              style={{
                background: "var(--dpf-bg)",
                color: "var(--dpf-text)",
                border: "1px solid var(--dpf-border)",
              }}
            />
          </>
        )}

        {/* Say what will happen BEFORE it happens. */}
        <div className="mt-4 text-xs">
          {resolved.why ? (
            <span style={{ color: "var(--dpf-error)" }}>{resolved.why}</span>
          ) : (
            <span style={{ color: "var(--dpf-muted)" }}>
              Will run{" "}
              <span style={{ color: "var(--dpf-text)" }}>
                {describeSchedule(resolved.schedule ?? "")}
              </span>
              {nextFire && (
                <>
                  {" "}
                  — next fire{" "}
                  <span style={{ color: "var(--dpf-text)" }}>
                    {nextFire.toLocaleString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </>
              )}
              {unchanged && " (unchanged)"}
            </span>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded"
            style={{ border: "1px solid var(--dpf-border)", color: "var(--dpf-text)" }}
          >
            Cancel
          </button>
          <button
            onClick={() => resolved.schedule && onSave(resolved.schedule)}
            disabled={!resolved.schedule || unchanged}
            className="px-4 py-2 text-sm rounded font-medium"
            style={{
              background: resolved.schedule && !unchanged ? "var(--dpf-accent)" : "var(--dpf-bg)",
              color: resolved.schedule && !unchanged ? "var(--dpf-on-accent)" : "var(--dpf-muted)",
              border: "1px solid var(--dpf-border)",
            }}
          >
            Save cadence
          </button>
        </div>
      </div>
    </div>
  );
}
