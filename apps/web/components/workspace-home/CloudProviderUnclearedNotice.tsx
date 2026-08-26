import { AI_PROVIDER_CONNECTIONS_ROUTE } from "@/lib/ai-provider-routes";
import { Surface } from "@/components/ui/Surface";

/**
 * Connected, active, and cleared for nothing any turn uses (BI-575F0046).
 *
 * Deliberately a DIFFERENT notice from the local-only one. "Add a cloud
 * provider" is wrong here — one is already added. The missing thing is the trust
 * review that grants it clearance above `public`, and no turn is ever `public`,
 * so until that happens the provider is listed, healthy and idle.
 */
export function CloudProviderUnclearedNotice({ providerNames }: { providerNames: string[] }) {
  const named = providerNames.length === 1
    ? providerNames[0]
    : `${providerNames.length} cloud providers`;
  return (
    <Surface as="section" aria-label="AI provider notice" padding="sm" className="mb-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">
            {named} is connected, but your team is still working locally
          </p>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">
            We hold a new connection back from real work until you confirm how that account
            handles your business data. It takes a minute.
          </p>
        </div>
        <a
          href={AI_PROVIDER_CONNECTIONS_ROUTE}
          className="inline-flex min-h-9 items-center justify-center rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 text-sm font-semibold text-[var(--dpf-text)]"
        >
          Confirm data handling
        </a>
      </div>
    </Surface>
  );
}
