import {
  formatMarketingDate,
  formatMarketingLabel,
  type MarketingWorkspaceSnapshot,
} from "@/lib/marketing";
import { assessArchetypeFit } from "@/lib/marketing/archetype-fit";
import { DraftAssetButton } from "./DraftAssetButton";
import { ArchetypeFitBadge } from "./ArchetypeFitNotice";

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

function EmptyWorkProduct({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[var(--dpf-muted)]">{children}</p>;
}

export function MarketingStrategyOverview({
  snapshot,
  mode = "summary",
}: Props) {
  const isDetail = mode === "detail";
  const strategy = snapshot.strategy;
  const category = snapshot.storefront.category;
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
    <div className="space-y-4">
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
                <li key={`${asset.type}-${asset.label}`} className="flex flex-wrap items-center gap-2">
                  <span>{asset.label}</span>
                  <span className="text-[var(--dpf-muted)]">
                    {formatMarketingLabel(asset.type)}
                  </span>
                  <ArchetypeFitBadge
                    assessment={assessArchetypeFit({ text: asset.label, category })}
                  />
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

      <Section title="Strategist work products">
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium text-[var(--dpf-text)]">Campaign briefs</h3>
            {snapshot.workProducts.campaignBriefs.length > 0 ? (
              <ul className="space-y-3 text-sm">
                {snapshot.workProducts.campaignBriefs.map((brief) => (
                  <li key={brief.briefId} className="border-l border-[var(--dpf-border)] pl-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-[var(--dpf-text)]">{brief.title}</p>
                      <ArchetypeFitBadge
                        assessment={assessArchetypeFit({
                          text: [brief.title, brief.objective, brief.audience, brief.notes]
                            .filter(Boolean)
                            .join("\n"),
                          category,
                        })}
                      />
                    </div>
                    <p className="text-[var(--dpf-muted)]">{brief.objective}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {brief.channels.map((channel) => (
                        <Pill key={channel}>{formatMarketingLabel(channel)}</Pill>
                      ))}
                      <Pill>{formatMarketingLabel(brief.status)}</Pill>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyWorkProduct>
                No campaign brief has been saved yet. Ask the strategist to turn the current plan into a brief.
              </EmptyWorkProduct>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-[var(--dpf-text)]">Proof and content tasks</h3>
            {snapshot.workProducts.assetTasks.length > 0 ? (
              <ul className="space-y-3 text-sm">
                {snapshot.workProducts.assetTasks.map((task) => (
                  <li key={task.taskId} className="border-l border-[var(--dpf-border)] pl-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-[var(--dpf-text)]">{task.title}</p>
                      <ArchetypeFitBadge
                        assessment={assessArchetypeFit({
                          text: [task.title, task.brief].filter(Boolean).join("\n"),
                          category,
                        })}
                      />
                    </div>
                    <p className="text-[var(--dpf-muted)]">
                      {formatMarketingLabel(task.assetType)}
                      {task.dueWindow ? ` - ${task.dueWindow}` : ""}
                    </p>
                    {task.brief && <p className="mt-1 text-[var(--dpf-text)]">{task.brief}</p>}
                    <DraftAssetButton assetTaskId={task.taskId} assetTaskTitle={task.title} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyWorkProduct>
                No proof or content tasks are queued yet.
              </EmptyWorkProduct>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-[var(--dpf-text)]">KPI checkpoints</h3>
            {snapshot.workProducts.kpiCheckpoints.length > 0 ? (
              <ul className="space-y-3 text-sm">
                {snapshot.workProducts.kpiCheckpoints.map((checkpoint) => (
                  <li key={checkpoint.checkpointId} className="border-l border-[var(--dpf-border)] pl-3">
                    <p className="font-medium text-[var(--dpf-text)]">{checkpoint.metric}</p>
                    <p className="text-[var(--dpf-muted)]">
                      {checkpoint.target ?? "Target not set"}
                      {checkpoint.cadence ? ` - ${formatMarketingLabel(checkpoint.cadence)}` : ""}
                    </p>
                    {checkpoint.notes && <p className="mt-1 text-[var(--dpf-text)]">{checkpoint.notes}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyWorkProduct>
                No KPI checkpoint has been recorded yet.
              </EmptyWorkProduct>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-[var(--dpf-text)]">Automation candidates</h3>
            {snapshot.workProducts.automationCandidates.length > 0 ? (
              <ul className="space-y-3 text-sm">
                {snapshot.workProducts.automationCandidates.map((candidate) => (
                  <li key={candidate.candidateId} className="border-l border-[var(--dpf-border)] pl-3">
                    <p className="font-medium text-[var(--dpf-text)]">{candidate.title}</p>
                    <p className="text-[var(--dpf-muted)]">
                      {candidate.trigger} -&gt; {candidate.action}
                    </p>
                    <p className="mt-1 text-[var(--dpf-text)]">
                      {candidate.approvalRequired ? "Requires approval" : "Internal-only automation"}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyWorkProduct>
                No automation candidates are waiting for review.
              </EmptyWorkProduct>
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}
