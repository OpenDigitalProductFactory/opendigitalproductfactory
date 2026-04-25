import {
  formatMarketingDate,
  formatMarketingLabel,
  type MarketingWorkspaceSnapshot,
} from "@/lib/marketing";

type Props = {
  snapshot: MarketingWorkspaceSnapshot;
  mode?: "summary" | "detail";
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <h2 className="mb-3 text-base font-semibold text-[var(--dpf-text)]">{title}</h2>
      {children}
    </section>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-1 text-[11px] text-[var(--dpf-text)]">
      {children}
    </span>
  );
}

export function MarketingStrategyOverview({
  snapshot,
  mode = "summary",
}: Props) {
  const isDetail = mode === "detail";
  const strategy = snapshot.strategy;
  const territory =
    strategy.geographicScope ?? snapshot.organization.addressSummary ?? "Market territory still needs a decision";
  const constraintNotes = strategy.constraints
    ? [
        strategy.constraints.geography ? `Territory: ${strategy.constraints.geography}` : null,
        strategy.constraints.capacity ? `Capacity: ${strategy.constraints.capacity}` : null,
        strategy.constraints.compliance ? `Compliance: ${strategy.constraints.compliance}` : null,
        strategy.constraints.productMaturity ? `Maturity: ${strategy.constraints.productMaturity}` : null,
      ].filter((note): note is string => Boolean(note))
    : [];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Market and buyer">
        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="text-[var(--dpf-muted)]">Business</dt>
            <dd className="text-[var(--dpf-text)]">{snapshot.organization.name}</dd>
          </div>
          <div>
            <dt className="text-[var(--dpf-muted)]">Business pattern</dt>
            <dd className="text-[var(--dpf-text)]">
              {snapshot.storefront.archetypeName ?? "Not set"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--dpf-muted)]">Sales motion</dt>
            <dd className="text-[var(--dpf-text)]">
              {formatMarketingLabel(strategy.routeToMarket)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--dpf-muted)]">Where to win first</dt>
            <dd className="text-[var(--dpf-text)]">{territory}</dd>
          </div>
          <div>
            <dt className="text-[var(--dpf-muted)]">Market shape</dt>
            <dd className="text-[var(--dpf-text)]">
              {formatMarketingLabel(strategy.localityModel)}
            </dd>
          </div>
          {strategy.primaryGoal && (
            <div>
              <dt className="text-[var(--dpf-muted)]">Primary promise</dt>
              <dd className="text-[var(--dpf-text)]">{strategy.primaryGoal}</dd>
            </div>
          )}
        </dl>
      </Section>

      <Section title="Channels and proof">
        <div className="mb-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-[var(--dpf-muted)]">
            Likely channels
          </p>
          <div className="flex flex-wrap gap-2">
            {strategy.primaryChannels.length > 0 ? (
              strategy.primaryChannels.map((channel) => (
                <Pill key={channel}>{formatMarketingLabel(channel)}</Pill>
              ))
            ) : (
              <span className="text-sm text-[var(--dpf-muted)]">
                Ask the strategist which channel deserves the first test.
              </span>
            )}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-[var(--dpf-muted)]">
            Credibility to build
          </p>
          {strategy.proofAssets.length > 0 ? (
            <ul className="space-y-2 text-sm text-[var(--dpf-text)]">
              {strategy.proofAssets.map((asset) => (
                <li key={`${asset.type}-${asset.label}`}>
                  {asset.label}
                  <span className="ml-2 text-[var(--dpf-muted)]">
                    {formatMarketingLabel(asset.type)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--dpf-muted)]">
              Ask the strategist what proof would make the first campaign believable.
            </p>
          )}
        </div>
      </Section>

      <Section title="Audience">
        <div className="mb-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-[var(--dpf-muted)]">
            Buyer groups
          </p>
          {strategy.targetSegments.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {strategy.targetSegments.map((segment) => (
                <li key={segment.name}>
                  <p className="text-[var(--dpf-text)]">{segment.name}</p>
                  {segment.description && (
                    <p className="text-[var(--dpf-muted)]">{segment.description}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--dpf-muted)]">
              Ask the strategist to help choose the first buyer group.
            </p>
          )}
        </div>

        {strategy.idealCustomerProfiles.length > 0 && (
          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-[var(--dpf-muted)]">
              Best-fit customer profiles
            </p>
            <ul className="space-y-3 text-sm">
              {strategy.idealCustomerProfiles.map((profile) => (
                <li key={profile.name}>
                  <p className="font-medium text-[var(--dpf-text)]">{profile.name}</p>
                  {profile.traits.length > 0 && (
                    <p className="text-[var(--dpf-muted)]">
                      Traits: {profile.traits.join(", ")}
                    </p>
                  )}
                  {isDetail && profile.painPoints.length > 0 && (
                    <p className="text-[var(--dpf-muted)]">
                      Pain points: {profile.painPoints.join(", ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Review rhythm">
        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="text-[var(--dpf-muted)]">Strategy check-in</dt>
            <dd className="text-[var(--dpf-text)]">
              {formatMarketingLabel(strategy.reviewCadence)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--dpf-muted)]">Next check-in</dt>
            <dd className="text-[var(--dpf-text)]">
              {formatMarketingDate(strategy.nextReviewAt)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--dpf-muted)]">Last strategist review</dt>
            <dd className="text-[var(--dpf-text)]">
              {formatMarketingDate(strategy.lastReviewedAt)}
            </dd>
          </div>
          {isDetail && strategy.serviceTerritories.length > 0 && (
            <div>
              <dt className="text-[var(--dpf-muted)]">Named territories</dt>
              <dd className="text-[var(--dpf-text)]">
                {strategy.serviceTerritories.map((territory) => territory.name).join(", ")}
              </dd>
            </div>
          )}
          {isDetail && strategy.entryOffers.length > 0 && (
            <div>
              <dt className="text-[var(--dpf-muted)]">Offers to lead with</dt>
              <dd className="space-y-2 text-[var(--dpf-text)]">
                {strategy.entryOffers.map((offer) => (
                  <div key={offer.name}>
                    <p>{offer.name}</p>
                    {offer.description && (
                      <p className="text-[var(--dpf-muted)]">{offer.description}</p>
                    )}
                  </div>
                ))}
              </dd>
            </div>
          )}
          {isDetail && constraintNotes.length > 0 && (
            <div>
              <dt className="text-[var(--dpf-muted)]">Guardrails</dt>
              <dd className="space-y-1 text-[var(--dpf-text)]">
                {constraintNotes.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </dd>
            </div>
          )}
        </dl>
      </Section>
    </div>
  );
}
