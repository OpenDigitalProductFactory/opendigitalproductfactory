"use client";

// Work Atlas rhythm strip (BI-D8A6F0F2, design §3.5): a standing room's last 14
// days, one mark per day. Each state has its own shape as well as its colour:
// on time is filled, late is half filled in the need colour, a day that did not
// run is an outlined cross, so no two states differ by colour alone.

import Link from "next/link";

import { Surface } from "@/components/ui/Surface";
import { encodeWorkCaseKey } from "@/lib/work-management/case-key";
import type { RhythmSlotState } from "@/lib/work-management/standing-run-history";
import type { StandingRhythmRow } from "@/lib/work-management/standing-run-history.server";
import { intentStyle, resolveIntent } from "@/lib/ui-model/statusColors";
import { useT } from "@/lib/i18n/use-t";

const LEGEND: RhythmSlotState[] = ["on-time", "late", "missed", "running", "due", "no-record"];

function shortDate(date: string, locale: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
}

function markFill(state: RhythmSlotState, colour: string): string {
  if (state === "on-time") return colour;
  if (state === "late") return `linear-gradient(135deg, ${colour} 50%, transparent 50%)`;
  return "transparent";
}

/** `decorative` marks sit beside their own words (the legend), so they are hidden from screen readers. */
function Mark({ state, label, decorative = false }: { state: RhythmSlotState; label: string; decorative?: boolean }) {
  const style = intentStyle(resolveIntent("standingRhythm", state));
  const border = state === "due" ? "dashed" : state === "no-record" ? "dotted" : "solid";
  return (
    <span {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label, title: label })} data-rhythm-state={state}
      className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm text-dpf-caption font-bold leading-none"
      style={{
        background: markFill(state, style.fg),
        border: `1.5px ${border} ${state === "no-record" ? "var(--dpf-border)" : style.border}`,
        color: style.fg,
      }}>
      {state === "missed" ? "×" : state === "running" ? "•" : null}
    </span>
  );
}

/**
 * The Day-to-day operations band. An install with no standing rooms gets no
 * band, and what the marks mean sits behind a disclosure, so the page on
 * arrival carries only the rooms and their days.
 */
export function RhythmStrip({ rows, locale }: { rows: StandingRhythmRow[]; locale: string }) {
  const t = useT("workrooms");
  if (rows.length === 0) return null;
  return (
    <Surface aria-labelledby="standing-rhythm-heading" className="mt-6" rounded="xl">
      <h2 id="standing-rhythm-heading" className="text-base font-semibold text-[var(--dpf-text)]">{t("rhythm.heading")}</h2>
      <ul className="mt-2 divide-y divide-[var(--dpf-border)]">
        {rows.map((row) => {
          const { slots, runningSince, counts } = row.rhythm;
          const summary = runningSince
            ? t("rhythm.runningSince", { date: shortDate(runningSince, locale) })
            : counts.missed > 0 ? t("rhythm.missedCount", { count: counts.missed }) : t("rhythm.steady");
          return (
            <li key={row.capsuleId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
              <Link className="min-w-[12rem] flex-1 rounded-sm text-dpf-body font-medium text-[var(--dpf-accent)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
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
      <details className="mt-3">
        <summary className="cursor-pointer rounded-sm text-dpf-caption text-[var(--dpf-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">{t("rhythm.explain")}</summary>
        <p className="mt-2 max-w-3xl text-dpf-caption text-dpf-muted">{t("rhythm.intro")}</p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-dpf-caption text-dpf-muted">
          {LEGEND.map((state) => (
            <li key={state} className="flex items-center gap-1.5">
              <Mark state={state} label={t(`rhythm.state.${state}`)} decorative />
              {t(`rhythm.state.${state}`)}
            </li>
          ))}
        </ul>
      </details>
    </Surface>
  );
}
