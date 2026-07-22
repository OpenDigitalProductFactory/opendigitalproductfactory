// apps/web/components/owner-first/OwnerFirstDisclosure.tsx
//
// Progressive-disclosure wrapper for the professional/internal structure that
// used to OPEN the domain pages — CRM stages, HR role governance, accountant
// lanes, AR/AP/reporting taxonomy, platform posture (BI-3BCAF95F). It stays one
// click away for the owner who wants it, but no longer competes with today's
// action for the first viewport.
//
// A native <details>/<summary> so it works as a server component with zero client
// JS. `data-owner-first-detail` marks it as demoted structure for the UX checks.

import type { ReactNode } from "react";

export function OwnerFirstDisclosure({
  summary,
  hint,
  children,
  defaultOpen = false,
}: {
  /** The affordance label, e.g. "All CRM detail" or "Role governance & directory". */
  summary: string;
  /** Optional one-line context shown next to the label. */
  hint?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      data-owner-first-detail=""
      open={defaultOpen}
      className="group mb-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-[var(--dpf-text)] marker:hidden [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden
          className="text-[var(--dpf-muted)] transition-transform group-open:rotate-90"
        >
          ▸
        </span>
        <span>{summary}</span>
        {hint && <span className="text-xs font-normal text-[var(--dpf-muted)]">{hint}</span>}
      </summary>
      <div className="border-t border-[var(--dpf-border)] p-4">{children}</div>
    </details>
  );
}
