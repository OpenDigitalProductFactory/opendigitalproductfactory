import Link from "next/link";
import { ArrowRightCircle, ExternalLink, Link2, Sparkles } from "lucide-react";
import { CustomerStatusBadge } from "@/components/customer/CustomerStatusBadge";
import type {
  AcquisitionSignalView,
  AcquisitionSignalWorkspace,
} from "@/lib/crm/acquisition-signals";

type AcquisitionSignalRouterProps = {
  workspace: AcquisitionSignalWorkspace;
  formAction: (formData: FormData) => void | Promise<void>;
};

function SummaryPill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1 text-xs text-[var(--dpf-muted)]">
      {label}
    </span>
  );
}

function RouteSignalForm({
  signal,
  formAction,
}: {
  signal: AcquisitionSignalView;
  formAction: AcquisitionSignalRouterProps["formAction"];
}) {
  if (!signal.routeAction) return null;

  return (
    <form action={formAction} className="mt-4">
      <input type="hidden" name="title" value={signal.routeAction.title} />
      <input type="hidden" name="contactId" value={signal.routeAction.contactId} />
      <input type="hidden" name="accountId" value={signal.routeAction.accountId} />
      <input type="hidden" name="source" value={signal.routeAction.source} />
      <input type="hidden" name="sourceRefId" value={signal.routeAction.sourceRefId} />
      <input type="hidden" name="notes" value={signal.routeAction.notes} />
      <button
        type="submit"
        className="inline-flex items-center gap-2 rounded bg-[var(--dpf-accent)] px-3 py-2 text-xs font-medium text-white"
      >
        <ArrowRightCircle className="h-4 w-4" aria-hidden="true" />
        Create engagement
      </button>
    </form>
  );
}

function SignalCard({
  signal,
  formAction,
}: {
  signal: AcquisitionSignalView;
  formAction: AcquisitionSignalRouterProps["formAction"];
}) {
  return (
    <article className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            {signal.channelLabel} / {signal.observedAtLabel}
          </p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">{signal.title}</h3>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">{signal.summary}</p>
        </div>
        <CustomerStatusBadge
          label={signal.routingLabel}
          tone={signal.routingTone}
          className="px-2 py-1 text-[10px]"
        />
      </div>

      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-[var(--dpf-muted)]">Buyer/source</dt>
          <dd className="mt-1 text-[var(--dpf-text)]">{signal.buyerLabel}</dd>
        </div>
        <div>
          <dt className="text-[var(--dpf-muted)]">CRM anchor</dt>
          <dd className="mt-1 text-[var(--dpf-text)]">
            {signal.contactLabel ?? "Contact not confirmed"}
            {signal.accountLabel ? ` / ${signal.accountLabel}` : ""}
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
          Source evidence
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {signal.evidence.map((item) => (
            <span
              key={item}
              className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-2 py-1 text-[10px] text-[var(--dpf-muted)]"
            >
              {item}
            </span>
          ))}
        </div>
      </div>

      {signal.linkedEngagement ? (
        <div className="mt-4 flex items-center gap-2 rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 text-xs text-[var(--dpf-text)]">
          <Link2 className="h-4 w-4 text-[var(--dpf-accent)]" aria-hidden="true" />
          <span>
            {signal.linkedEngagement.title} / {signal.linkedEngagement.statusLabel}
          </span>
        </div>
      ) : null}

      {signal.integrationHref && signal.routingState === "needs_contact" ? (
        <Link
          href={signal.integrationHref}
          className="mt-4 inline-flex items-center gap-2 rounded border border-[var(--dpf-border)] px-3 py-2 text-xs font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Review source
        </Link>
      ) : null}

      {signal.aiTopics.length > 0 ? (
        <div className="mt-4">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            AI handoff ideas
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {signal.aiTopics.map((topic) => (
              <span
                key={topic.id}
                className="rounded-full border border-[var(--dpf-border)] px-2 py-1 text-[10px] text-[var(--dpf-muted)]"
                title={topic.description}
              >
                {topic.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <RouteSignalForm signal={signal} formAction={formAction} />
    </article>
  );
}

export function AcquisitionSignalRouter({
  workspace,
  formAction,
}: AcquisitionSignalRouterProps) {
  return (
    <section className="mb-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Signal routing
          </p>
          <h2 className="mt-1 text-base font-semibold text-[var(--dpf-text)]">
            Acquisition signals
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--dpf-muted)]">
            New storefront and connection evidence stays observed until someone explicitly turns it into CRM engagement.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SummaryPill label={`${workspace.summary.observedCount} observed`} />
          <SummaryPill label={`${workspace.summary.routeReadyCount} ready`} />
          <SummaryPill label={`${workspace.summary.linkedCount} linked`} />
          {workspace.summary.needsContactCount > 0 ? (
            <SummaryPill label={`${workspace.summary.needsContactCount} need contact`} />
          ) : null}
        </div>
      </div>

      {workspace.signals.length > 0 ? (
        <div className="mt-5 grid gap-3 xl:grid-cols-2">
          {workspace.signals.map((signal) => (
            <SignalCard
              key={signal.id}
              signal={signal}
              formAction={formAction}
            />
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-[var(--dpf-muted)]">
          No acquisition signals are waiting for review.
        </p>
      )}
    </section>
  );
}
