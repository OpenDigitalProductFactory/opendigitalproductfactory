"use client";

// ConsequenceNotice — risk-proportional consequence copy for a mutating or
// sensitive form action, kept behind progressive disclosure so a non-technical
// owner sees one plain summary line, not a wall of text (AGENTS.md §12/§17).
//
// It answers the four questions the form-contract requires for sensitive
// actions: what will change, who/what is affected, whether it can be reversed,
// and the recovery path. The summary is always visible; the four details expand
// on demand via a native <details> (the canonical construct for "one short,
// secondary piece of prose", per platform-usability-standards.md).

import type { ReactNode } from "react";
import { cx } from "./styles";

export type ConsequenceNoticeProps = {
  /** The always-visible one-line plain-language summary of what this does. */
  summary: ReactNode;
  /** What data/state changes. */
  what: ReactNode;
  /** Who or what is affected (the person, account, records). */
  who: ReactNode;
  /** Whether and how the action can be undone. */
  reversibility: ReactNode;
  /** How to recover / where to go if it was a mistake. */
  recovery: ReactNode;
  /** Visual weight. `danger` for destructive/irreversible actions. */
  tone?: "info" | "warning" | "danger";
  /** Expand the details by default (use for the most dangerous actions). */
  defaultOpen?: boolean;
  /** Text for the disclosure toggle. */
  detailsLabel?: string;
  className?: string;
};

const TONE_ACCENT: Record<NonNullable<ConsequenceNoticeProps["tone"]>, string> = {
  info: "var(--dpf-accent)",
  warning: "var(--dpf-warning)",
  danger: "var(--dpf-error)",
};

const TONE_BG: Record<NonNullable<ConsequenceNoticeProps["tone"]>, string> = {
  info: "var(--dpf-accent-soft)",
  warning: "var(--dpf-state-warning)",
  danger: "var(--dpf-state-error)",
};

export function ConsequenceNotice({
  summary,
  what,
  who,
  reversibility,
  recovery,
  tone = "info",
  defaultOpen = false,
  detailsLabel = "What happens when I do this?",
  className,
}: ConsequenceNoticeProps) {
  const rows: Array<{ term: string; detail: ReactNode }> = [
    { term: "What changes", detail: what },
    { term: "Who's affected", detail: who },
    { term: "Can it be undone", detail: reversibility },
    { term: "If it was a mistake", detail: recovery },
  ];

  return (
    <details
      open={defaultOpen}
      className={cx("rounded-md border px-3 py-2 text-sm", className)}
      style={{
        borderColor: TONE_ACCENT[tone],
        background: TONE_BG[tone],
        color: "var(--dpf-text)",
      }}
    >
      <summary className="cursor-pointer list-none font-medium marker:content-none">
        <span className="mr-1" aria-hidden="true" style={{ color: TONE_ACCENT[tone] }}>
          ⓘ
        </span>
        {summary}
        <span className="ml-1 text-xs text-[var(--dpf-muted)]">— {detailsLabel}</span>
      </summary>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map((row) => (
          <div key={row.term} className="contents">
            <dt className="text-xs font-semibold text-[var(--dpf-muted)]">{row.term}</dt>
            <dd className="text-xs text-[var(--dpf-text)]">{row.detail}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
