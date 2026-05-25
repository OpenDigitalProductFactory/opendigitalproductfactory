export function UnconfiguredWorkspaceHomeNotice() {
  return (
    <section
      aria-label="Workspace home setup"
      className="mb-5 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3 text-[var(--dpf-text)]"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">Workspace home is using the standard view</p>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">
            Review business setup to activate a worker home tailored to this business.
          </p>
        </div>
        <a
          href="/storefront"
          className="inline-flex min-h-9 items-center justify-center rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 text-sm font-semibold text-[var(--dpf-text)]"
        >
          Review business setup
        </a>
      </div>
    </section>
  );
}
