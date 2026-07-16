import Link from "next/link";

/**
 * Discoverability affordance for BI-1F35055C.
 *
 * On Discovery Operations, users asked where to enable "Data Enrichment" but no
 * verifiable in-product path was surfaced. Data Enrichment is not a Discovery
 * setting — it is an external data service enabled with the other MCP / provider
 * services under Platform → Tools & Services.
 *
 * The facts below are grounded in code, not invented:
 *   - Enabling a service / provider connection requires the
 *     `manage_provider_connections` capability (see apps/web/lib/govern/permissions.ts
 *     and the `requireManageProviders` guard in apps/web/lib/actions/mcp-services.ts).
 *   - That capability is granted only to role HR-000 (Admin / CDIO) and superusers;
 *     roles HR-100–HR-500 do not hold it and never see the enable controls.
 *
 * Pure presentational component (no DB / auth / client state) so it renders in a
 * plain node environment and is trivially unit-testable. Uses a native <details>
 * disclosure so the note stays collapsed and non-intrusive with no client JS.
 */
export function DataEnrichmentHelpNote() {
  return (
    <details className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <summary className="cursor-pointer list-none text-sm font-medium text-[var(--dpf-text)] marker:content-['']">
        <span className="text-[var(--dpf-accent)]">Where do I enable Data Enrichment?</span>
      </summary>
      <div className="mt-3 space-y-3 text-sm leading-6 text-[var(--dpf-text)]">
        <p>
          Data Enrichment is an external data service, not a Discovery setting. A platform
          admin enables it alongside the other MCP and provider services under{" "}
          <Link href="/platform/tools/services" className="text-[var(--dpf-accent)]">
            Platform → Tools &amp; Services
          </Link>
          . New services can be found first in the{" "}
          <Link href="/platform/tools/catalog" className="text-[var(--dpf-accent)]">
            Tool Marketplace
          </Link>
          .
        </p>
        <p className="text-[var(--dpf-muted)]">
          <span className="font-semibold text-[var(--dpf-text)]">Who can enable it:</span>{" "}
          only the Admin role (HR-000) and superusers can enable services or provider
          connections. Other roles (HR-100–HR-500) do not see the enable controls.
        </p>
        <p className="text-[var(--dpf-muted)]">
          <span className="font-semibold text-[var(--dpf-text)]">Not an admin?</span> Ask your
          platform admin (HR-000 / CDIO) to enable Data Enrichment for you.
        </p>
      </div>
    </details>
  );
}
