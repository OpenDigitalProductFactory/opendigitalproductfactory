export function IdentityPlaceholderPanel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">{title}</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">{description}</p>
      </div>

      <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
          In Progress
        </p>
        <p className="mt-2 text-sm text-[var(--dpf-text)]">
          This section is part of the new unified identity workspace. The current slice establishes the route shell first so principals, agent identity, and upcoming federation controls all live under one stable platform home.
        </p>
      </div>
    </section>
  );
}
