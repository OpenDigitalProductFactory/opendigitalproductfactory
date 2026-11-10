// BI-4EAFF7AC: one labelled list of pages that relate to the page being read.
//
// Moved out of MaterialBacklinksPanel (spec 2026-10-14 knowledge-linking §4.2) so
// the material panel and the wiki "Linked from" panel share one presentation.
// The old copy rendered each page as a <span>; here every page is a real link.

import Link from "next/link";
import type { ReactNode } from "react";

import { WikiPageKindBadge } from "./WikiPageKindBadge";

export type BacklinkItem = {
  id: string;
  title: string;
  href: string;
  pageKind?: string;
  /** Short scope or relation label, e.g. "Platform" or "Links the platform page". */
  badges?: string[];
  context?: string | null;
  action?: { href: string; label: string } | null;
};

export function BacklinkGroup({
  label,
  items,
  emptyLabel = "None",
}: {
  /** Omit when the surrounding control already names the list. */
  label?: string;
  items: BacklinkItem[];
  emptyLabel?: string;
}): ReactNode {
  return (
    <div>
      {label ? <h3 className="text-xs font-semibold text-[var(--dpf-muted)]">{label}</h3> : null}
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--dpf-muted)]">{emptyLabel}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <Link href={item.href} className="font-medium text-[var(--dpf-accent)] hover:underline">
                  {item.title}
                </Link>
                {item.pageKind ? <WikiPageKindBadge pageKind={item.pageKind} /> : null}
                {(item.badges ?? []).map((badge) => (
                  <span
                    key={badge}
                    className="rounded border border-[var(--dpf-border)] px-1.5 py-0.5 text-dpf-caption text-[var(--dpf-muted)]"
                  >
                    {badge}
                  </span>
                ))}
              </div>
              {item.context ? (
                <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-[var(--dpf-muted)]">{item.context}</p>
              ) : null}
              {item.action ? (
                <Link
                  href={item.action.href}
                  className="mt-1 inline-block rounded border border-[var(--dpf-border)] px-2 py-0.5 text-xs text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
                >
                  {item.action.label}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
