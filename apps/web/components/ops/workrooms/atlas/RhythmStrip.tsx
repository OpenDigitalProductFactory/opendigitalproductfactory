"use client";

// Work Atlas rhythm strip (BI-D8A6F0F2, design §3.5): a standing room's last 14
// days, one mark per day. Finished on time is filled, finished late is filled
// in the need colour, and a day that did not run is an outlined cross, so
// missed and late differ without colour.

import Link from "next/link";

import { encodeWorkCaseKey } from "@/lib/work-management/case-key";
import type { RhythmSlotState } from "@/lib/work-management/standing-run-history";
import type { StandingRhythmRow } from "@/lib/work-management/standing-run-history.server";
import { intentStyle, resolveIntent } from "@/lib/ui-model/statusColors";
import { useT } from "@/lib/i18n/use-t";

const LEGEND: RhythmSlotState[] = ["on-time", "late", "missed", "running", "due", "no-record"];

function shortDate(date: string, locale: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
}

function Mark({ state, label }: { state: RhythmSlotState; label: string }) {
  const style = intentStyle(resolveIntent("standingRhythm", state));
  const filled = state === "on-time" || state === "late";
  const border = state === "due" ? "dashed" : state === "no-record" ? "dotted" : "solid";
  return (
    <span role="img" aria-label={label} title={label} data-rhythm-state={state}
      className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm text-dpf-caption font-bold leading-none"
      style={{
        background: filled ? style.fg : "transparent",
        border: `1.5px ${border} ${state === "no-record" ? "var(--dpf-border)" : style.border}`,
        color: style.fg,
      }}>
      {state === "missed" ? "×" : state === "running" ? "•" : null}
    </span>
  );
}

export function RhythmStrip({ rows, locale = "en-US" }: { rows: StandingRhythmRow[]; locale?: string }) {
  const t = useT("workrooms");
  if (rows.length === 0) return <p className="text-dpf-caption text-dpf-muted">{t("rhythm.empty")}</p>;
  return (
    <div>
      <ul className="divide-y divide-[var(--dpf-border)]">
        {rows.map((row) => {
          const { slots, runningSince, counts } = row.rhythm;
          const summary = runningSince
            ? t("rhythm.runningSince", { date: shortDate(runningSince, locale) })
            : counts.missed > 0 ? t("rhythm.missedCount", { count: counts.missed }) : t("rhythm.steady");
          return (
            <li key={row.capsuleId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
              <Link className="min-w-[12rem] flex-1 text-dpf-body font-medium text-[var(--dpf-accent)] hover:underline"
                href={`/workspace/cases/${encodeWorkCaseKey({ sourceType: "work-capsule", sourceId: row.capsuleId })}`}>
                {row.title}
              </Link>
              <ol aria-label={t("rhythm.cycles", { room: row.title })} className="flex gap-1">
                {slots.map((slot) => (
                  <li key={slot.date}>
                    <Mark state={slot.state}
                      label={t("rhythm.cell", { date: shortDate(slot.date, locale), state: t(`rhythm.state.${slot.state}`) })} />
                  </li>
                ))}
              </ol>
              <span className="w-44 text-dpf-caption text-dpf-muted">{summary}</span>
            </li>
          );
        })}
      </ul>
      <ul aria-hidden="true" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-dpf-caption text-dpf-muted">
        {LEGEND.map((state) => (
          <li key={state} className="flex items-center gap-1.5">
            <Mark state={state} label={t(`rhythm.state.${state}`)} />
            {t(`rhythm.state.${state}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}
