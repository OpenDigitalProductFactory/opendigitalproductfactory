// apps/web/app/(shell)/platform/tools/catalog/page.tsx
import Link from "next/link";
import { runMcpCatalogSyncIfDue } from "@/lib/actions/mcp-catalog";
import { getConnectionCatalog, type ConnectionCatalogEntry } from "@/lib/actions/connection-catalog";
import { IntegrationCard } from "@/components/platform/IntegrationCard";
import { IntegrationCatalogFilters } from "@/components/platform/IntegrationCatalogFilters";

type SearchParams = Promise<{ q?: string; category?: string; pricing?: string; archetype?: string }>;

function ConnectionCard({ entry }: { entry: Exclude<ConnectionCatalogEntry, { kind: "mcp" }> }) {
  return (
    <Link
      href={entry.href}
      className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5 transition-transform hover:-translate-y-0.5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold text-[var(--dpf-text)]">{entry.name}</h3>
            <span className="rounded-full border border-[var(--dpf-border)] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-[var(--dpf-muted)]">
              {entry.kind === "native" ? "Native" : "Built-in"}
            </span>
          </div>
          {entry.description ? (
            <p className="text-sm text-[var(--dpf-muted)]">{entry.description}</p>
          ) : null}
        </div>
        <span className="rounded-full bg-[var(--dpf-surface-2)] px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--dpf-text)]">
          {entry.statusLabel}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Category</p>
          <p className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">{entry.category}</p>
        </div>
        <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Model</p>
          <p className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">{entry.model}</p>
        </div>
      </div>

      {"capability" in entry ? (
        <p className="mt-4 text-xs text-[var(--dpf-muted)]">
          Capability: <span className="font-mono text-[var(--dpf-text)]">{entry.capability}</span>
        </p>
      ) : null}
    </Link>
  );
}

export default async function ToolsCatalogPage({ searchParams }: { searchParams: SearchParams }) {
  await runMcpCatalogSyncIfDue();

  const { q = "", category, pricing, archetype } = await searchParams;

  const catalog = await getConnectionCatalog({
    query: q,
    ...(category ? { category } : {}),
    ...(pricing ? { pricingModel: pricing } : {}),
    ...(archetype ? { archetypeId: archetype } : {}),
    limit: 60,
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Connection Catalog</h1>
          <p className="text-muted-foreground text-sm">
            {catalog.totalCount.toLocaleString()} connection entries across MCP, native integrations, and built-in tools
          </p>
        </div>
        <a href="/platform/tools/catalog/sync" className="text-sm text-primary hover:underline">
          Manage sync →
        </a>
      </div>

      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm text-[var(--dpf-muted)]">
        Use this catalog to discover what DPF can connect to, then move into{" "}
        <Link href="/platform/tools/services" className="text-[var(--dpf-accent)] underline">
          MCP Services
        </Link>{" "}
        or the source-specific setup surface when you are ready to operate it.
      </div>

      <IntegrationCatalogFilters />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">MCP Catalog</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--dpf-text)]">{catalog.counts.mcp}</p>
        </div>
        <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Native Integrations</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--dpf-text)]">{catalog.counts.native}</p>
        </div>
        <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Built-in Tools</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--dpf-text)]">{catalog.counts.builtIn}</p>
        </div>
      </div>

      {catalog.totalCount === 0 ? (
        <p className="text-muted-foreground text-sm py-12 text-center">
          No catalog entries found. Try a different search or run a sync.
        </p>
      ) : (
        <div className="space-y-8">
          {catalog.sections.map((section) => (
            <section key={section.kind} className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold text-[var(--dpf-text)]">{section.title}</h2>
                <p className="text-sm text-[var(--dpf-muted)]">{section.description}</p>
              </div>

              {section.entries.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6 text-sm text-[var(--dpf-muted)]">
                  No matching {section.title.toLowerCase()} entries for the current filters.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {section.entries.map((entry) =>
                    entry.kind === "mcp" ? (
                      <IntegrationCard
                        key={`${entry.kind}:${entry.id}`}
                        integration={{
                          id: entry.id,
                          name: entry.name,
                          vendor: entry.vendor,
                          shortDescription: entry.description,
                          category: entry.category,
                          pricingModel: entry.pricingModel,
                          rating: entry.rating,
                          ratingCount: entry.ratingCount,
                          isVerified: entry.isVerified,
                          documentationUrl: entry.documentationUrl,
                          logoUrl: entry.logoUrl,
                          activeServerId: entry.activeServerId,
                        }}
                      />
                    ) : (
                      <ConnectionCard key={`${entry.kind}:${entry.id}`} entry={entry} />
                    ),
                  )}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
