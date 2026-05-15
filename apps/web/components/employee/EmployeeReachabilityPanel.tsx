import { CheckCircle2, Clock3, PauseCircle, XCircle } from "lucide-react";

export type ReachabilityBinding = {
  channel: string;
  label: string;
  status: "pending" | "verified" | "failed" | "disabled";
  lastTestedAt: string | null;
  allowedUrgencies?: string[];
};

const statusIcons = {
  pending: Clock3,
  verified: CheckCircle2,
  failed: XCircle,
  disabled: PauseCircle,
} satisfies Record<ReachabilityBinding["status"], typeof CheckCircle2>;

function formatLastTested(value: string | null): string {
  if (!value) return "Not tested";

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function EmployeeReachabilityPanel({
  bindings,
}: {
  bindings: ReachabilityBinding[];
}) {
  return (
    <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Reachability</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">
            Verified employee channels for governed notifications, approvals, and follow-ups.
          </p>
        </div>
        <span className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs font-medium text-[var(--dpf-text)]">
          {bindings.length} configured
        </span>
      </header>

      {bindings.length === 0 ? (
        <p className="mt-4 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-sm text-[var(--dpf-muted)]">
          No employee channels are configured yet.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--dpf-border)] border-y border-[var(--dpf-border)]">
          {bindings.map((binding) => {
            const StatusIcon = statusIcons[binding.status];

            return (
              <li
                key={`${binding.channel}:${binding.label}`}
                className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-[var(--dpf-text)]">{binding.label}</p>
                    <span className="inline-flex items-center gap-1 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-0.5 text-xs text-[var(--dpf-text)]">
                      <StatusIcon className="size-3.5 text-[var(--dpf-accent)]" aria-hidden="true" />
                      {binding.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                    Last tested {formatLastTested(binding.lastTestedAt)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                  {(binding.allowedUrgencies?.length ? binding.allowedUrgencies : ["routine"]).map(
                    (urgency) => (
                      <span
                        key={`${binding.channel}:${urgency}`}
                        className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-0.5 text-xs text-[var(--dpf-muted)]"
                      >
                        {urgency}
                      </span>
                    ),
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
