import { AskCoworkerButton } from "@/components/agent/AskCoworkerButton";
import type { ProviderOnboardingRecommendation, ProviderRecommendationItem } from "@/lib/routing/provider-suitability/onboarding-recommendation";

function ConnectionList({ items }: { items: ProviderRecommendationItem[] }) {
  if (items.length === 0) return <p className="m-0 text-xs text-[var(--dpf-muted)]">None yet.</p>;
  return (
    <ul className="m-0 space-y-2 pl-4 text-xs text-[var(--dpf-text)]">
      {items.map((item) => (
        <li key={`${item.providerConnectionId}:${item.scope}`}>
          <span className="font-semibold">{item.label}</span>{" — "}{item.reason}
        </li>
      ))}
    </ul>
  );
}

export function ProviderSuitabilityGuide({ recommendation }: { recommendation: ProviderOnboardingRecommendation }) {
  const statusLabel = recommendation.status === "ready" ? "Ready with guardrails" : recommendation.status === "review-needed" ? "Review needed" : "Setup needed";
  return (
    <section aria-labelledby="provider-suitability-heading" className="mb-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--dpf-accent)]">Business-safe provider guidance</p>
          <h2 id="provider-suitability-heading" className="mt-1 text-base font-semibold text-[var(--dpf-text)]">{recommendation.headline}</h2>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">{statusLabel}. A working login proves connectivity only; it does not prove business terms, retention, training treatment, or processing region.</p>
        </div>
        <AskCoworkerButton
          prompt={`Act as my COO. Review the current provider-suitability result (${recommendation.status}) for these workload classes: ${recommendation.workloadClasses.join(", ")}. Consult AGT-902 through the governed coworker interface for regulation and sovereignty questions. Use only the business context already stored in DPF, do not include customer records or secrets, cite every factual provider or regulatory claim, distinguish provider-published terms from evidence for our connected account, state unknowns, and give one safest next action.`}
          routeContext="/platform/ai/providers"
          label="Ask my COO to explain"
          className="rounded-md border border-[var(--dpf-border)] px-3 py-2 text-xs font-semibold text-[var(--dpf-accent)] hover:bg-[var(--dpf-surface-2)]"
        />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-md border border-[var(--dpf-border)] p-3">
          <h3 className="mb-2 text-xs font-semibold text-[var(--dpf-text)]">Use now</h3>
          <ConnectionList items={recommendation.useNow} />
        </div>
        <div className="rounded-md border border-[var(--dpf-border)] p-3">
          <h3 className="mb-2 text-xs font-semibold text-[var(--dpf-text)]">Use after review</h3>
          <ConnectionList items={recommendation.useAfterReview} />
        </div>
        <div className="rounded-md border border-[var(--dpf-border)] p-3">
          <h3 className="mb-2 text-xs font-semibold text-[var(--dpf-text)]">Not for this work</h3>
          <ConnectionList items={recommendation.notForThisWork} />
        </div>
      </div>

      <details className="mt-4 text-xs text-[var(--dpf-text)]">
        <summary className="cursor-pointer font-semibold">What leaves, what stays, and what DPF blocks</summary>
        <dl className="mt-3 grid gap-2 md:grid-cols-3">
          <div><dt className="font-semibold">May leave</dt><dd className="m-0 text-[var(--dpf-muted)]">{recommendation.whatMayLeave}</dd></div>
          <div><dt className="font-semibold">Stays controlled</dt><dd className="m-0 text-[var(--dpf-muted)]">{recommendation.whatStaysLocal}</dd></div>
          <div><dt className="font-semibold">Blocked</dt><dd className="m-0 text-[var(--dpf-muted)]">{recommendation.whatDpfBlocks}</dd></div>
        </dl>
      </details>
      <p className="mt-4 text-xs font-semibold text-[var(--dpf-text)]">Next: {recommendation.nextAction}</p>
      <p className="mt-1 text-[11px] text-[var(--dpf-muted)]">{recommendation.caveat}</p>
    </section>
  );
}
