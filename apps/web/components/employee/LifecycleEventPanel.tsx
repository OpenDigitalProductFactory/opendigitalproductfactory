type LifecycleEvent = {
  id: string;
  eventId: string;
  eventType: string;
  effectiveAt: Date;
  reason: string | null;
  createdAt: Date;
};

type Props = {
  events: LifecycleEvent[];
};

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(value);
}

export function LifecycleEventPanel({ events }: Props) {
  return (
    <section className="rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Recent lifecycle events</h2>
        <p className="text-xs text-[var(--dpf-muted)] mt-1">
          Append-only workforce timeline for onboarding, role movement, and exits.
        </p>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No lifecycle events recorded yet.</p>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <article
              key={event.id}
              className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-[var(--dpf-text)]">{event.eventType}</p>
                  <p className="text-[10px] font-mono text-[var(--dpf-muted)]">{event.eventId}</p>
                </div>
                <p className="text-[10px] text-[var(--dpf-muted)]">{formatDate(event.effectiveAt)}</p>
              </div>
              {event.reason && <p className="mt-2 text-xs text-[var(--dpf-muted)]">{event.reason}</p>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
