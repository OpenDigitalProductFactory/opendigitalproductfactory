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
