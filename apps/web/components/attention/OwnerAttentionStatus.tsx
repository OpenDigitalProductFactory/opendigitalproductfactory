export function OwnerAllCaughtUp({
  handlingCount,
  examples,
}: {
  handlingCount: number;
  examples: string[];
}) {
  return (
    <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-4 py-4">
      <p className="text-sm font-semibold text-[var(--dpf-text)]">You&apos;re all caught up</p>
      <p className="mt-1 text-sm text-[var(--dpf-muted)]">
        Nothing needs a decision from you right now.
      </p>
      {handlingCount > 0 ? (
        <div className="mt-3 border-t border-[var(--dpf-border)] pt-3">
          <p className="text-xs font-semibold text-[var(--dpf-text)]">
            Your digital team is handling {handlingCount} {handlingCount === 1 ? "item" : "items"} —
            no action needed.
          </p>
          {examples.length > 0 ? (
            <ul className="mt-1 space-y-1">
              {examples.map((headline, index) => (
                <li key={index} className="text-xs text-[var(--dpf-muted)]">
                  — {headline}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function OwnerAttentionCount({ count }: { count: number }) {
  return (
    <p className="text-sm font-semibold text-[var(--dpf-text)]">
      {count} {count === 1 ? "thing needs" : "things need"} you today
    </p>
  );
}

export function DigitalTeamHandlingStrip({
  custodianCount,
  digestCount,
}: {
  custodianCount: number;
  digestCount: number;
}) {
  if (custodianCount === 0 && digestCount === 0) return null;
  return (
    <aside className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-4 py-3 text-xs leading-relaxed text-[var(--dpf-muted)]">
      {custodianCount > 0 ? (
        <span>
          <span className="font-semibold text-[var(--dpf-text)]">Your digital team is handling</span>{" "}
          {custodianCount} {custodianCount === 1 ? "item" : "items"} — no action needed.
        </span>
      ) : null}
      {custodianCount > 0 && digestCount > 0 ? " " : null}
      {digestCount > 0 ? (
        <span>
          {digestCount} {digestCount === 1 ? "item" : "items"} saved for Friday review.
        </span>
      ) : null}
    </aside>
  );
}
