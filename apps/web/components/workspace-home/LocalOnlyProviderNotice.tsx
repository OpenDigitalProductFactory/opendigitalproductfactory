import { AI_PROVIDER_CONNECTIONS_ROUTE } from "@/lib/ai-provider-routes";

export function LocalOnlyProviderNotice() {
  return (
    <section
      aria-label="AI provider notice"
      className="mb-5 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3 text-[var(--dpf-text)]"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">Your built-in local AI is ready</p>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">
            Everyday work stays on this machine. A cloud provider is optional for larger tasks or
            workloads your organization has approved for cloud processing.
          </p>
        </div>
        <a
          href={AI_PROVIDER_CONNECTIONS_ROUTE}
          className="inline-flex min-h-9 items-center justify-center rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 text-sm font-semibold text-[var(--dpf-text)]"
        >
          Add optional cloud AI
        </a>
      </div>
    </section>
  );
}
