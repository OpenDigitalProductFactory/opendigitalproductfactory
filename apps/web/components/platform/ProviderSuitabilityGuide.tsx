import { AskCoworkerButton } from "@/components/agent/AskCoworkerButton";
import type { ProviderOnboardingRecommendation, ProviderRecommendationItem } from "@/lib/routing/provider-suitability/onboarding-recommendation";
import { formatProviderReviewObjective } from "@/lib/routing/provider-suitability/provider-review-packet";
import type { ProviderRoutingTelemetryRollup } from "@/lib/inference/provider-routing-rollup";

const WORKLOAD_LABELS: Record<string, string> = {
  "public-marketing": "Public marketing",
  "internal-operations": "Internal operations",
  "customer-records": "Customer records",
  "employee-records": "Employee records",
  "payments-finance": "Payments and financial records",
  "health-phi": "Health and patient information",
  "student-records": "Student records",
  "regulated-decisioning": "Regulated decisions",
  "legal-privileged": "Legally privileged work",
  "secrets-credentials": "Secrets and credentials",
  "source-code": "Source code",
  "unknown-restricted": "Unclassified restricted work",
};

function ConnectionList({ items, emptyMessage }: { items: ProviderRecommendationItem[]; emptyMessage: string }) {
  if (items.length === 0) return <p className="m-0 text-xs text-[var(--dpf-muted)]">{emptyMessage}</p>;
  return (
    <ul className="m-0 min-w-0 space-y-2 pl-4 text-xs text-[var(--dpf-text)]">
      {items.map((item) => (
        <li className="min-w-0 break-words" key={`${item.providerConnectionId}:${item.scope}`}>
          <span className="font-semibold break-words">{item.label}</span>{" — "}{item.reason}
        </li>
      ))}
    </ul>
  );
}

export function ProviderSuitabilityGuide({ recommendation, telemetry }: { recommendation: ProviderOnboardingRecommendation; telemetry?: ProviderRoutingTelemetryRollup }) {
  const statusLabel = recommendation.status === "ready" ? "Ready with guardrails" : recommendation.status === "review-needed" ? "Review needed" : "Setup needed";
  const specialistObjective = formatProviderReviewObjective(recommendation.reviewPacket);
  return (
    <section aria-labelledby="provider-suitability-heading" className="mb-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--dpf-accent)]">Business-safe provider guidance</p>
          <h2 id="provider-suitability-heading" className="mt-1 text-base font-semibold text-[var(--dpf-text)]">{recommendation.headline}</h2>
          <p role="status" aria-live="polite" className="mt-1 text-xs text-[var(--dpf-muted)]">Status: {statusLabel}. A working login proves connectivity only; it does not prove business terms, retention, training treatment, or processing region.</p>
        </div>
        <div className="max-w-xs">
          <AskCoworkerButton
            prompt={`Act as my COO. Consult AGT-902 through the governed coworker interface using this validated, minimized objective; do not reconstruct the request from display copy. Return the grounded result here with one safest next action.\n\n${specialistObjective}`}
            // /workspace is the canonical route owned by the COO persona. The
            // prompt carries the provider-page facts while the COO delegates
            // specialist compliance questions through the governed interface.
            routeContext="/workspace"
            providerReviewPacket={recommendation.reviewPacket}
            label="Ask my COO to explain"
            ariaDescribedBy="provider-coo-coordination"
            className="rounded-md border border-[var(--dpf-border)] px-3 py-2 text-xs font-semibold text-[var(--dpf-accent)] hover:bg-[var(--dpf-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
          />
          <p id="provider-coo-coordination" className="mt-1 text-[11px] text-[var(--dpf-muted)]">
            Your COO coordinates the Data Governance specialist. You stay in this conversation and keep the decision.
          </p>
        </div>
      </div>

      <div role="region" aria-label="Work DPF is protecting" className="mt-4 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
        <p className="m-0 text-xs font-semibold text-[var(--dpf-text)]">Work DPF is protecting</p>
        <p className="mt-1 text-[11px] text-[var(--dpf-muted)]">Derived from the company profile, markets, products, customers, and planned AI work. Correct these labels before relying on the recommendation.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {recommendation.workloadClasses.map((workload) => (
            <span key={workload} className="rounded-full border border-[var(--dpf-border)] px-2 py-1 text-[11px] text-[var(--dpf-text)]">
              {WORKLOAD_LABELS[workload] ?? workload.replaceAll("-", " ")}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div role="region" aria-label="Use now" className="min-w-0 rounded-md border border-[var(--dpf-border)] p-3">
          <h3 className="mb-2 text-xs font-semibold text-[var(--dpf-text)]">Use now</h3>
          <ConnectionList items={recommendation.useNow} emptyMessage="No connection is approved to use now." />
        </div>
        <div role="region" aria-label="Use after review" className="min-w-0 rounded-md border border-[var(--dpf-border)] p-3">
          <h3 className="mb-2 text-xs font-semibold text-[var(--dpf-text)]">Use after review</h3>
          <ConnectionList items={recommendation.useAfterReview} emptyMessage="No connection is waiting for review." />
        </div>
        <div role="region" aria-label="Not for this work" className="min-w-0 rounded-md border border-[var(--dpf-border)] p-3">
          <h3 className="mb-2 text-xs font-semibold text-[var(--dpf-text)]">Not for this work</h3>
          <ConnectionList items={recommendation.notForThisWork} emptyMessage="No connection is blocked for this work." />
        </div>
      </div>

      <details className="mt-4 text-xs text-[var(--dpf-text)]">
        <summary className="cursor-pointer rounded-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">What leaves, what stays, and what DPF blocks</summary>
        <dl className="mt-3 grid gap-2 md:grid-cols-3">
          <div><dt className="font-semibold">May leave</dt><dd className="m-0 text-[var(--dpf-muted)]">{recommendation.whatMayLeave}</dd></div>
          <div><dt className="font-semibold">Stays controlled</dt><dd className="m-0 text-[var(--dpf-muted)]">{recommendation.whatStaysLocal}</dd></div>
          <div><dt className="font-semibold">Blocked</dt><dd className="m-0 text-[var(--dpf-muted)]">{recommendation.whatDpfBlocks}</dd></div>
        </dl>
      </details>
      <p className="mt-4 text-xs font-semibold text-[var(--dpf-text)]">Next action: {recommendation.nextAction}</p>
      <p className="mt-1 text-[11px] text-[var(--dpf-muted)]">DPF continuously watches evidence expiry, account/channel drift, regional entitlement changes, and repeated route failures. Observations can request review or lower a recommendation, but cannot override a policy denial.</p>
      {telemetry && telemetry.totalRequests > 0 && (
        <div className="mt-3 rounded-md border border-[var(--dpf-border)] p-3 text-xs text-[var(--dpf-text)]">
          <div className="font-semibold">Last 30 days: {telemetry.totalRequests} governed route decision{telemetry.totalRequests === 1 ? "" : "s"}</div>
          <div className="mt-1 text-[11px] text-[var(--dpf-muted)]">
            {telemetry.selectedRoutes} selected · {telemetry.exclusions} blocked before dispatch. Workload detail appears only after at least {telemetry.minimumCohortSize} similar decisions; {telemetry.suppressedWorkloadClasses.length} small cohort{telemetry.suppressedWorkloadClasses.length === 1 ? " is" : "s are"} hidden.
          </div>
        </div>
      )}
      <p className="mt-1 text-[11px] text-[var(--dpf-muted)]">{recommendation.caveat}</p>
    </section>
  );
}
