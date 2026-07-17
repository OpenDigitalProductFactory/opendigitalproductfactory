"use client";

import type { ReactNode } from "react";

export interface ExpandableCardProps {
  /** Stable, page-unique id used to associate the trigger and panel. */
  id: string;
  /** Controlled expanded state. A parent can enforce single-open accordion behavior. */
  open: boolean;
  /** Called with the next expanded state when the summary trigger is activated. */
  onOpenChange: (open: boolean) => void;
  /** Always-visible record summary. Render domain labels, badges, and metadata here. */
  summary: ReactNode;
  /** Optional always-visible controls rendered outside the disclosure button.
   * Use this when the record has primary actions that must not be nested in the
   * interactive summary trigger. */
  actions?: ReactNode;
  /** Inline detail content revealed below the summary. */
  children: ReactNode;
  /** Heading level appropriate to the surrounding page hierarchy. Default 3. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  className?: string;
  panelClassName?: string;
}

/**
 * Canonical inline record disclosure.
 *
 * Use this when a list of peer records reveals one record's detail in place.
 * Use CollapsibleList for truncating one long list, and a drawer or route when
 * the detail is a separate workspace rather than subordinate record content.
 */
export function ExpandableCard({
  id,
  open,
  onOpenChange,
  summary,
  actions,
  children,
  headingLevel = 3,
  className = "",
  panelClassName = "",
}: ExpandableCardProps) {
  const triggerId = `${id}-trigger`;
  const panelId = `${id}-panel`;
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4" | "h5" | "h6";

  return (
    <article
      data-open={open ? "true" : "false"}
      className={`overflow-hidden rounded-lg border transition-colors ${
        open
          ? "border-[var(--dpf-accent)]/40 bg-[var(--dpf-surface-2)]"
          : "border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] hover:border-[var(--dpf-accent)]/30"
      } ${className}`}
    >
      <Heading className="m-0">
        <button
          type="button"
          id={triggerId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onOpenChange(!open)}
          className="flex w-full cursor-pointer items-start justify-between gap-4 p-4 text-left text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--dpf-accent)]"
        >
          <span className="min-w-0 flex-1">{summary}</span>
          <span
            aria-hidden="true"
            data-testid="expandable-card-indicator"
            className="mt-0.5 shrink-0 text-sm text-[var(--dpf-muted)]"
          >
            {open ? "▾" : "▸"}
          </span>
        </button>
      </Heading>

      {actions ? (
        <div className="border-t border-[var(--dpf-border)] px-4 py-3">{actions}</div>
      ) : null}

      {open && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={triggerId}
          className={`border-t border-[var(--dpf-border)] p-4 text-[var(--dpf-text)] ${panelClassName}`}
        >
          {children}
        </div>
      )}
    </article>
  );
}
