export function DirectionLoadingState() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading product direction"
      className="space-y-dpf-lg"
    >
      <p className="text-dpf-body text-[var(--dpf-muted)]">
        Loading product direction…
      </p>
      <div
        aria-hidden="true"
        className="grid gap-dpf-md sm:grid-cols-2"
      >
        {["decision", "evidence", "bets", "outcomes"].map((section) => (
          <div
            key={section}
            className="min-h-32 rounded-dpf-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
          />
        ))}
      </div>
    </div>
  );
}
