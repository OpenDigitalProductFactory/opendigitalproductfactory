import type { CoworkerCatalog, CoworkerOfferCatalogItem } from "@/lib/coworker-service-catalog/catalog";
import { oversightLabel } from "@/lib/workforce/oversight-copy";

export function CoworkerCatalogView({ catalog }: { catalog: CoworkerCatalog }) {
  const activeOffers = catalog.offers.filter((offer) => offer.status === "active");
  const highRisk = catalog.offers.filter((offer) => offer.riskTier === "high" || offer.riskTier === "critical").length;
  const external = catalog.offers.filter((offer) => offer.availabilityScope === "external").length;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-xl font-semibold text-[var(--dpf-text)]">Coworker Service Catalog</h1>
          <p className="mt-1 max-w-3xl text-xs text-[var(--dpf-muted)]">
            Service capabilities, packaged offers, and governed engagement requests for AI coworkers.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-right">
          <Metric label="Services" value={catalog.services.length} />
          <Metric label="Offers" value={activeOffers.length} />
          <Metric label="High risk" value={highRisk} />
        </div>
      </header>

      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <div
            data-catalog-layout="mobile"
            className="divide-y divide-[var(--dpf-border)] border-y border-[var(--dpf-border)] lg:hidden"
          >
            {activeOffers.length === 0 ? (
              <div className="py-8 text-sm text-[var(--dpf-muted)]">
                No active coworker offers are cataloged yet.
              </div>
            ) : (
              activeOffers.map((offer) => (
                <MobileOfferRow key={offer.offerId} offer={offer} />
              ))
            )}
          </div>

          <div
            data-catalog-layout="desktop"
            className="hidden overflow-x-auto rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] lg:block"
          >
            <div className="min-w-[740px]">
              <div className="grid grid-cols-[minmax(220px,1.4fr)_minmax(160px,0.9fr)_110px_130px_120px] border-b border-[var(--dpf-border)] px-3 py-2 text-[11px] font-semibold uppercase text-[var(--dpf-muted)]">
                <span>Offer</span>
                <span>Provider</span>
                <span>Risk</span>
                <span>Authority</span>
                <span>Availability</span>
              </div>
              <div>
                {activeOffers.length === 0 ? (
                  <div className="px-3 py-8 text-sm text-[var(--dpf-muted)]">
                    No active coworker offers are cataloged yet.
                  </div>
                ) : (
                  activeOffers.map((offer) => (
                    <OfferRow key={offer.offerId} offer={offer} />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <aside className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Engagement Controls</h2>
          <dl className="mt-3 space-y-3 text-xs">
            <div>
              <dt className="font-semibold text-[var(--dpf-muted)]">Engagement</dt>
              <dd className="mt-1 text-[var(--dpf-text)]">Requests create engagement records first; execution links a Work Capsule only after acceptance.</dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--dpf-muted)]">External providers</dt>
              <dd className="mt-1 text-[var(--dpf-text)]">{external} offer{external === 1 ? "" : "s"} require explicit terms and data-boundary context.</dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--dpf-muted)]">Approval posture</dt>
              <dd className="mt-1 text-[var(--dpf-text)]">High-risk and approval-required offers route through proposal/envelope rails before action.</dd>
            </div>
          </dl>
        </aside>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-20 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2">
      <div className="text-base font-semibold text-[var(--dpf-text)]">{value}</div>
      <div className="text-[11px] text-[var(--dpf-muted)]">{label}</div>
    </div>
  );
}

function OfferRow({ offer }: { offer: CoworkerOfferCatalogItem }) {
  const legalRisk = typeof offer.metadata.legalRisk === "string" ? offer.metadata.legalRisk : null;
  return (
    <div className="grid grid-cols-[minmax(220px,1.4fr)_minmax(160px,0.9fr)_110px_130px_120px] gap-0 border-b border-[var(--dpf-border)] px-3 py-3 text-xs last:border-b-0">
      <div className="min-w-0">
        <div className="font-semibold text-[var(--dpf-text)]">{offer.name}</div>
        <div className="mt-1 text-[var(--dpf-muted)]">{offer.summary}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip label="Service" value={offer.serviceName} />
          <Chip label="Offer" value={offer.version} />
          <Chip label="Engagement" value={offer.requiredApprovals.length ? "approval-aware" : "requestable"} />
          {legalRisk ? <Chip label="Legal" value={legalRisk} /> : null}
        </div>
      </div>
      <Cell primary={offer.provider.displayName} secondary={offer.providerOrganization ?? offer.provider.kind} />
      <Cell primary={offer.riskTier} secondary={oversightLabel(offer.service.hitlTier, { short: true })} />
      <Cell primary={offer.authorityBoundary} secondary={offer.requiredApprovals.length ? "approval required" : "no approval rule"} />
      <Cell primary={offer.availabilityScope} secondary={offer.digitalProduct?.name ?? "No product anchor"} />
    </div>
  );
}

function MobileOfferRow({ offer }: { offer: CoworkerOfferCatalogItem }) {
  const legalRisk =
    typeof offer.metadata.legalRisk === "string"
      ? offer.metadata.legalRisk
      : null;
  return (
    <article className="min-w-0 py-4">
      <h2 className="text-sm font-semibold text-[var(--dpf-text)]">
        {offer.name}
      </h2>
      <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">
        {offer.summary}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        <MobileFact label="Service" value={offer.serviceName} />
        <MobileFact label="Provider" value={offer.provider.displayName} />
        <MobileFact
          label="Risk"
          value={`${offer.riskTier}; ${oversightLabel(offer.service.hitlTier, { short: true })}`}
        />
        <MobileFact label="Authority" value={offer.authorityBoundary} />
        <MobileFact label="Availability" value={offer.availabilityScope} />
        <MobileFact
          label="Engagement"
          value={
            offer.requiredApprovals.length
              ? "Approval required"
              : "Requestable"
          }
        />
        {legalRisk ? <MobileFact label="Legal" value={legalRisk} /> : null}
      </dl>
    </article>
  );
}

function MobileFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-semibold text-[var(--dpf-muted)]">{label}</dt>
      <dd className="mt-1 break-words text-[var(--dpf-text)]">{value}</dd>
    </div>
  );
}

function Cell({ primary, secondary }: { primary: string; secondary: string }) {
  return (
    <div className="min-w-0 px-2">
      <div className="truncate font-medium text-[var(--dpf-text)]">{primary}</div>
      <div className="mt-1 truncate text-[var(--dpf-muted)]">{secondary}</div>
    </div>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-[var(--dpf-border)] px-1.5 py-0.5 text-[11px] text-[var(--dpf-muted)]">
      <span className="font-semibold text-[var(--dpf-text)]">{label}</span>
      <span>{value}</span>
    </span>
  );
}
