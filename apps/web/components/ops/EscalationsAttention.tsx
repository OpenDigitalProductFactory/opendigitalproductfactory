// Escalations attention lens for the ONE operator surface (/ops).
// BI-0ACD9AB2 surface convergence: self-fix escalations the platform held for a
// responder (awaiting_escalation_ack) surface HERE, where the operator already
// works, instead of in a separate /admin queue. Read + deep-link only — the
// governed responder (WWMD-consult disposition) layers on top in a later slice.
// Server component (no client state); /ops is force-dynamic so age is fresh.

import Link from "next/link";
import {
  escalationSelfFixLabel,
  escalationAgeLabel,
  type OpenEscalation,
} from "@/lib/quality/escalation-attention";
import { EscalationConsult } from "./EscalationConsult";

export function EscalationsAttention({ escalations }: { escalations: OpenEscalation[] }) {
  if (escalations.length === 0) return null;
  const nowMs = Date.now();

  return (
    <section className="mb-6 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--dpf-border)]">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--dpf-text)]">
          Escalations awaiting attention
        </h2>
        <span className="text-[10px] font-semibold text-[var(--dpf-accent)]">
          {escalations.length}
        </span>
        <Link
          href="/admin/issue-reports"
          className="ml-auto text-[10px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Evidence trail →
        </Link>
      </div>

      <p className="px-3 pt-2 text-[11px] text-[var(--dpf-muted)]">
        Builds Build Studio could not self-repair — held for a responder, attended here in your one
        Operations surface rather than a separate queue.
      </p>

      <ul className="mt-1 divide-y divide-[var(--dpf-border)]">
        {escalations.map((e) => (
          <li key={e.reportId} className="flex items-start gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded border border-[var(--dpf-accent)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--dpf-accent)]">
                  {escalationSelfFixLabel(e.selfFixClass)}
                </span>
                <span className="text-[9px] uppercase tracking-wide text-[var(--dpf-muted)]">
                  {e.severity}
                </span>
                <span className="text-[10px] text-[var(--dpf-muted)]">
                  {escalationAgeLabel(e.createdAt, nowMs)}
                </span>
                <span className="text-[10px] text-[var(--dpf-muted)]">· {e.reportId}</span>
              </div>
              <p className="mt-1 truncate text-xs text-[var(--dpf-text)]">{e.title}</p>
              <EscalationConsult reportId={e.reportId} />
            </div>
            {e.buildId ? (
              <Link
                href={`/build?buildId=${encodeURIComponent(e.buildId)}`}
                className="shrink-0 text-[10px] font-semibold text-[var(--dpf-accent)] hover:opacity-80"
              >
                View build →
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
