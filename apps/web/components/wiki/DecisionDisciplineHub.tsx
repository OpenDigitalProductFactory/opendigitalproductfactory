// EP-0AF96937 Phase 1: the decision-governance landing hub.
//
// Reframes the top of the former "Wiki" page from a document-taxonomy list
// (Principles/Stances/Heuristics/…) into the three decision disciplines a
// business actually reasons about — WWMD (platform doctrine), WWWD (the
// organization's own business doctrine), and WSID (each role's craft). The raw
// kernel material is retained below this hub as a drill-in, not the front door.
//
// Presentational + server-friendly: all health is derived by the page and
// passed in as plain data, so this component does no I/O. Theme-aware per
// AGENTS.md §12 (no hardcoded colors).

import Link from "next/link";
import type { ReactNode } from "react";

export type DisciplineKey = "wwmd" | "wwwd" | "wsid";

export type DisciplineChipTone = "neutral" | "warning" | "success";

export type DisciplineChip = {
  label: string;
  tone?: DisciplineChipTone;
};

export type DisciplineAction = {
  label: string;
  href: string;
  /** Accent the action (used for the discipline's primary "Adjust"/owner action). */
  emphasis?: boolean;
};

export type DisciplineCardModel = {
  key: DisciplineKey;
  /** Short code shown as the card title, e.g. "WWMD". */
  code: string;
  /** What the acronym expands to, e.g. "What would Mark do". */
  expansion: string;
  /** One-line, plain-language subtitle of what this discipline governs. */
  blurb: string;
  /** Derived health chips (counts, coverage, open gaps). */
  chips: DisciplineChip[];
  /** See / Adjust / Review action links. */
  actions: DisciplineAction[];
  /** Accent this card (WWWD — the discipline the business most owns). */
  featured?: boolean;
};

function chipClasses(tone: DisciplineChipTone | undefined): string {
  switch (tone) {
    case "warning":
      return "text-[var(--dpf-warning)] border-[var(--dpf-warning)]";
    case "success":
      return "text-[var(--dpf-success)] border-[var(--dpf-success)]";
    default:
      return "text-[var(--dpf-muted)] border-[var(--dpf-border)]";
  }
}

function DisciplineCard({ card }: { card: DisciplineCardModel }): ReactNode {
  return (
    <div
      className={[
        "flex flex-col rounded-xl border bg-[var(--dpf-surface-1)] p-4",
        card.featured
          ? "border-[var(--dpf-accent)]"
          : "border-[var(--dpf-border)]",
      ].join(" ")}
    >
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-base font-semibold text-[var(--dpf-text)]">
          {card.code}
        </h3>
        {card.featured && (
          <span className="rounded bg-[var(--dpf-accent-soft)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--dpf-accent)]">
            yours to shape
          </span>
        )}
      </div>
      <p className="text-xs text-[var(--dpf-muted)]">{card.expansion}</p>
      <p className="mt-2 text-sm text-[var(--dpf-text-secondary)]">
        {card.blurb}
      </p>

      {card.chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {card.chips.map((chip) => (
            <span
              key={chip.label}
              className={`rounded border px-2 py-0.5 text-xs ${chipClasses(chip.tone)}`}
            >
              {chip.label}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2 pt-1">
        {card.actions.map((action) => (
          <Link
            key={action.label}
            href={action.href}
            className={[
              "rounded-md border px-2.5 py-1 text-xs transition-colors",
              action.emphasis
                ? "border-[var(--dpf-accent)] text-[var(--dpf-accent)] hover:bg-[var(--dpf-accent-soft)]"
                : "border-[var(--dpf-border)] text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]",
            ].join(" ")}
          >
            {action.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function DecisionDisciplineHub({
  cards,
}: {
  cards: DisciplineCardModel[];
}): ReactNode {
  return (
    <section aria-label="Decision disciplines">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <DisciplineCard key={card.key} card={card} />
        ))}
      </div>
    </section>
  );
}
