// Connection-readiness card for Platform > Connections.
//
// Renders the pairing preflight (lib/federation/connection-readiness) as a
// legible checklist so an operator SEES which install-local `.env` value is
// missing — and the exact line to add — before attempting to pair, instead of
// hitting an opaque 401. Server-rendered (no hooks): the values are read from
// the environment in page.tsx and passed in. Purely informational; the fixes
// are applied by the operator via `.env` + `/ops/self-upgrade`, never by the app.

import { StatusBadge } from "@/components/ui/report-kit";
import type {
  ConnectionReadiness,
  ConnectionReadinessItem,
} from "@/lib/federation/connection-readiness";

function badgeFor(status: ConnectionReadinessItem["status"]) {
  switch (status) {
    case "ok":
      return <StatusBadge intent="success" label="Ready" />;
    case "action-required":
      return <StatusBadge intent="warning" label="Action needed" />;
    case "not-applicable":
    default:
      return <StatusBadge intent="neutral" label="Not needed" />;
  }
}

export function ConnectionReadinessCard({
  readiness,
}: {
  readiness: ConnectionReadiness;
}) {
  const ready = readiness.overall === "ready";
  return (
    <section
      aria-label="Connection readiness"
      className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">
          Connection readiness
        </h2>
        {ready ? (
          <StatusBadge intent="success" label="Ready to connect" />
        ) : (
          <StatusBadge intent="warning" label="Setup needed" />
        )}
      </div>
      {ready ? null : (
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          Add each line below to this installation&rsquo;s configuration, then
          re-apply the update.
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {readiness.items.map((it) => (
          <li
            key={it.key}
            className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-[var(--dpf-text)]">
                {it.label}
              </span>
              {badgeFor(it.status)}
            </div>
            <p className="mt-1 text-sm text-[var(--dpf-muted)]">{it.detail}</p>
            {it.fix ? (
              <p className="mt-2 text-xs text-[var(--dpf-muted)]">
                <code className="rounded bg-[var(--dpf-surface-1)] px-1.5 py-0.5 font-mono text-[var(--dpf-text)]">
                  {it.fix}
                </code>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
