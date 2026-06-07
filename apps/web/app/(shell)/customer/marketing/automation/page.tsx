import {
  MarketingEmptyState,
  MarketingIntentBadge,
  MarketingLifecycleBadge,
  MarketingMetricGrid,
  MarketingPageHeader,
  MarketingRecordCard,
  MarketingSection,
} from "@/components/customer-marketing/MarketingRoutePrimitives";
import { getMarketingWorkspaceSnapshot } from "@/lib/marketing";
import { buildMarketingAutomationView } from "@/lib/marketing/subroutes";

export default async function CustomerMarketingAutomationPage() {
  const snapshot = await getMarketingWorkspaceSnapshot();

  if (!snapshot) {
    return (
      <MarketingEmptyState
        title="Automation candidates are waiting for organization setup"
        description="Governed automation ideas become available once the organization workspace has been initialized."
      />
    );
  }

  const view = buildMarketingAutomationView(snapshot);

  return (
    <div className="space-y-6">
      <MarketingPageHeader
        eyebrow="Customer Marketing"
        title="Automation candidates"
        description="Review suggested marketing automations, triggers, and approval posture before any workflow is enabled."
        actionHref="/customer/marketing"
        actionLabel="Back to overview"
      />

      <MarketingMetricGrid metrics={view.metrics} />

      <MarketingSection
        title="Candidate workflows"
        description="This route is read-only in Slice 4. Approval, scheduling, and policy controls stay governed by later execution work."
      >
        {view.candidates.length === 0 ? (
          <MarketingEmptyState
            title="No automation candidates saved"
            description="Ask the Marketing Strategist to identify repetitive follow-up or campaign work that could become an approval-gated automation."
            actionHref="/customer/marketing"
            actionLabel="Open strategist workspace"
          />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {view.candidates.map((candidate) => (
              <MarketingRecordCard key={candidate.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-[var(--dpf-text)]">
                      {candidate.title}
                    </h2>
                    <p className="mt-1 text-sm text-[var(--dpf-muted)]">
                      {candidate.rationale}
                    </p>
                  </div>
                  <MarketingLifecycleBadge status={candidate.status} />
                </div>

                <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">
                      Trigger
                    </dt>
                    <dd className="mt-1 text-[var(--dpf-text)]">{candidate.trigger}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">
                      Action
                    </dt>
                    <dd className="mt-1 text-[var(--dpf-text)]">{candidate.action}</dd>
                  </div>
                </dl>

                <div className="mt-4 flex flex-wrap gap-2">
                  <MarketingIntentBadge
                    intent={candidate.intent}
                    label={candidate.approvalLabel}
                  />
                  <MarketingIntentBadge intent="neutral" label={candidate.safetyLabel} />
                </div>
              </MarketingRecordCard>
            ))}
          </div>
        )}
      </MarketingSection>

      <MarketingSection title="Guardrail">
        <MarketingRecordCard>
          <p className="text-sm text-[var(--dpf-text)]">
            Automation candidates shown here are proposals. They do not publish,
            send, schedule, or mutate CRM data until a governed workflow adds the
            appropriate approval and audit path.
          </p>
        </MarketingRecordCard>
      </MarketingSection>
    </div>
  );
}
