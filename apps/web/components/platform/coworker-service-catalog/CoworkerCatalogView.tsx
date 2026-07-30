import type { CoworkerCatalog, CoworkerOfferCatalogItem } from "@/lib/coworker-service-catalog/catalog";
import { oversightLabel } from "@/lib/workforce/oversight-copy";

export function CoworkerCatalogView({ catalog }: { catalog: CoworkerCatalog }) {
  const activeOffers = catalog.offers.filter((offer) => offer.status === "active");
  const activeOfferRows = activeOffers.map((offer) => ({
    offer,
    presentation: projectOfferPresentation(offer),
  }));
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
              activeOfferRows.map(({ offer, presentation }) => (
                <MobileOfferRow
                  key={offer.offerId}
                  offer={offer}
                  presentation={presentation}
                />
              ))
            )}
          </div>

          <div
            data-catalog-layout="desktop"
            className="hidden overflow-x-auto rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] lg:block"
          >
            <table className="w-full min-w-[740px] table-fixed border-collapse text-left">
              <colgroup>
                <col className="w-[31%]" />
                <col className="w-[22%]" />
                <col className="w-[14%]" />
                <col className="w-[18%]" />
                <col className="w-[15%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-[var(--dpf-border)] text-[11px] font-semibold uppercase text-[var(--dpf-muted)]">
                  <th className="px-3 py-2" scope="col">Offer</th>
                  <th className="px-2 py-2" scope="col">Provider</th>
                  <th className="px-2 py-2" scope="col">Risk</th>
                  <th className="px-2 py-2" scope="col">Authority</th>
                  <th className="px-2 py-2" scope="col">Availability</th>
                </tr>
              </thead>
              <tbody>
                {activeOffers.length === 0 ? (
                  <tr>
                    <td className="px-3 py-8 text-sm text-[var(--dpf-muted)]" colSpan={5}>
                      No active coworker offers are cataloged yet.
                    </td>
                  </tr>
                ) : (
                  activeOfferRows.map(({ offer, presentation }) => (
                    <OfferRow
                      key={offer.offerId}
                      offer={offer}
                      presentation={presentation}
                    />
                  ))
                )}
              </tbody>
            </table>
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

type OfferPresentation = {
  chips: Array<{ label: string; value: string }>;
  provider: {
    primary: string;
    secondary: string;
    secondaryLabel: "Provider organization" | "Provider type";
  };
  risk: { primary: string; secondary: string };
  authority: { primary: string; secondary: string };
  availability: { primary: string; secondary: string };
  mobileFacts: Array<{ label: string; value: string }>;
};

export function projectOfferPresentation(
  offer: CoworkerOfferCatalogItem,
): OfferPresentation {
  const legalRisk =
    typeof offer.metadata.legalRisk === "string"
      ? offer.metadata.legalRisk
      : null;
  const engagement = offer.requiredApprovals.length
    ? "Approval-aware"
    : "Requestable";
  const provider = {
    primary: offer.provider.displayName,
    secondary: offer.providerOrganization ?? offer.provider.kind,
    secondaryLabel: offer.providerOrganization
      ? "Provider organization" as const
      : "Provider type" as const,
  };
  const risk = {
    primary: offer.riskTier,
    secondary: oversightLabel(offer.service.hitlTier, { short: true }),
  };
  const authority = {
    primary: offer.authorityBoundary,
    secondary: offer.requiredApprovals.length
      ? "Approval required"
      : "No approval rule",
  };
  const availability = {
    primary: offer.availabilityScope,
    secondary: offer.digitalProduct?.name ?? "No product anchor",
  };
  const chips = [
    { label: "Service", value: offer.serviceName },
    { label: "Offer", value: offer.version },
    { label: "Engagement", value: engagement },
    ...(legalRisk ? [{ label: "Legal", value: legalRisk }] : []),
  ];

  return {
    chips,
    provider,
    risk,
    authority,
    availability,
    mobileFacts: [
      { label: "Service", value: offer.serviceName },
      { label: "Version", value: offer.version },
      { label: "Provider", value: provider.primary },
      { label: provider.secondaryLabel, value: provider.secondary },
      {
        label: "Risk",
        value: `${risk.primary}; ${risk.secondary}`,
      },
      {
        label: "Authority",
        value: `${authority.primary}; ${authority.secondary}`,
      },
      {
        label: "Availability",
        value: `${availability.primary}; ${availability.secondary}`,
      },
      { label: "Engagement", value: engagement },
      ...(legalRisk ? [{ label: "Legal", value: legalRisk }] : []),
    ],
  };
}

function OfferRow({
  offer,
  presentation,
}: {
  offer: CoworkerOfferCatalogItem;
  presentation: OfferPresentation;
}) {
  return (
    <tr className="border-b border-[var(--dpf-border)] text-xs last:border-b-0">
      <td className="min-w-0 px-3 py-3 align-top">
        <div className="font-semibold text-[var(--dpf-text)]">{offer.name}</div>
        <div className="mt-1 text-[var(--dpf-muted)]">{offer.summary}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {presentation.chips.map((chip) => (
            <Chip key={chip.label} label={chip.label} value={chip.value} />
          ))}
        </div>
      </td>
      <Cell {...presentation.provider} />
      <Cell {...presentation.risk} />
      <Cell {...presentation.authority} />
      <Cell {...presentation.availability} />
    </tr>
  );
}

function MobileOfferRow({
  offer,
  presentation,
}: {
  offer: CoworkerOfferCatalogItem;
  presentation: OfferPresentation;
}) {
  return (
    <article className="min-w-0 py-4">
      <h2 className="text-sm font-semibold text-[var(--dpf-text)]">
        {offer.name}
      </h2>
      <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">
        {offer.summary}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        {presentation.mobileFacts.map((fact) => (
          <MobileFact
            key={fact.label}
            label={fact.label}
            value={fact.value}
          />
        ))}
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

function Cell({
  primary,
  secondary,
  secondaryLabel,
}: {
  primary: string;
  secondary: string;
  secondaryLabel?: string;
}) {
  return (
    <td className="min-w-0 px-2 py-3 align-top">
      <div className="truncate font-medium text-[var(--dpf-text)]">{primary}</div>
      <div className="mt-1 truncate text-[var(--dpf-muted)]">
        {secondaryLabel ? `${secondaryLabel}: ` : ""}
        {secondary}
      </div>
    </td>
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
