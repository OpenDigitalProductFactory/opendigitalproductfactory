import Link from "next/link";
import { StatusBadge, FilterBar, type FacetOption } from "@/components/ui/report-kit";
import { reconcileCapabilityNeedBacklog } from "@/lib/coworker-self-assessment/capability-backlog-reconcile";
import {
  getCoworkerCapabilityNeedReview,
  parseCoworkerCapabilityNeedReviewFilters,
  type CoworkerCapabilityNeedReview,
  type CoworkerCapabilityNeedReviewItem,
} from "@/lib/coworker-self-assessment/review-service";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const BASE_PATH = "/platform/ai/capability-needs";

export default async function CoworkerCapabilityNeedsPage({ searchParams }: PageProps) {
  // Drain any orphaned need into the backlog before rendering. New needs auto-
  // file at submission; this backfills legacy / never-filed ones so the view
  // never shows untracked work. Idempotent + non-fatal. EP-INTAKE-UNIFY Phase 6.
  await reconcileCapabilityNeedBacklog().catch(() => {});

  const params = await searchParams;
  const filters = parseCoworkerCapabilityNeedReviewFilters(params ?? {});
  const review = await getCoworkerCapabilityNeedReview(filters);

  const summary = summarize(review);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-[var(--dpf-muted)]">
            AI Operations
          </p>
          <h1 className="mt-1 text-xl font-bold text-[var(--dpf-text)]">Capability Needs</h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--dpf-muted)]">
            Evidence view for AI coworker self-assessments and capability gaps. Each
            need is auto-filed to the backlog and triaged there — the backlog is the
            one place work is tracked. Each row shows its backlog item&apos;s status.
          </p>
        </div>
        <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-xs text-[var(--dpf-muted)]">
          Evidence view
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Total" value={summary.total} />
        <SummaryCard label="Blockers" value={summary.blockers} />
        <SummaryCard label="Tracked in backlog" value={summary.tracked} />
        <SummaryCard label="In progress" value={summary.inProgress} />
      </section>

      <FilterBar
        mode="url"
        basePath={BASE_PATH}
        facets={[
          { kind: "pills", key: "severity", label: "Severity", options: toOptions(review.filterOptions.severities) },
          { kind: "pills", key: "kind", label: "Kind", options: toOptions(review.filterOptions.kinds) },
        ]}
        value={{ severity: filters.severity ?? "", kind: filters.kind ?? "" }}
        resultCount={review.needs.length}
      />

      <section className="space-y-3">
        {review.needs.map((need) => (
          <NeedRow key={need.needId} need={need} />
        ))}
        {review.needs.length === 0 ? (
          <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5 text-sm text-[var(--dpf-muted)]">
            No coworker capability needs match these filters.
          </div>
        ) : null}
      </section>
    </div>
  );
}

function summarize(review: CoworkerCapabilityNeedReview) {
  return {
    total: review.summary.total,
    blockers: review.summary.bySeverity.blocker ?? 0,
    tracked: review.needs.filter((n) => n.linkedBacklogItemId).length,
    inProgress: review.needs.filter((n) => n.linkedBacklogItemStatus === "in-progress").length,
  };
}

function toOptions(values: string[]): FacetOption[] {
  return values.map((value) => ({ value, label: value }));
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
      <div className="text-xs text-[var(--dpf-muted)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-[var(--dpf-text)]">{value}</div>
    </div>
  );
}

function NeedRow({ need }: { need: CoworkerCapabilityNeedReviewItem }) {
  return (
    <article className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--dpf-muted)]">
            <span className="font-medium text-[var(--dpf-text)]">{need.coworkerName}</span>
            <span>Tier {need.coworkerTier}</span>
            {need.valueStream ? <span>{need.valueStream}</span> : null}
            <span>{need.createdAtLabel}</span>
          </div>
          <h2 className="mt-2 text-base font-semibold text-[var(--dpf-text)]">{need.need}</h2>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">{need.blocks}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{need.severity}</Badge>
          <Badge>{need.kind}</Badge>
          {need.linkedBacklogItemStatus ? (
            <StatusBadge domain="backlogItem" status={need.linkedBacklogItemStatus} variant="soft" />
          ) : (
            <span className="text-xs italic text-[var(--dpf-muted)]">filing to backlog…</span>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <DetailBlock label="Assessment">
          <p>
            Verdict: <span className="text-[var(--dpf-text)]">{need.assessmentVerdict}</span>
          </p>
          <p>
            Confidence: <span className="text-[var(--dpf-text)]">{need.assessmentConfidence}</span>
          </p>
          {need.missionSummary ? <p>{need.missionSummary}</p> : null}
          {need.capabilitySummary ? <p>{need.capabilitySummary}</p> : null}
        </DetailBlock>
        <DetailBlock label="Evidence">
          <p>{need.evidencePreview}</p>
          <p>{need.readinessPreview}</p>
        </DetailBlock>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--dpf-muted)]">
        <span className="font-mono">{need.needId}</span>
        <span>Assessment {need.assessmentId}</span>
        {need.routeContext ? <span>Route {need.routeContext}</span> : null}
        {need.duplicateCount > 0 ? <span>{need.duplicateCount} duplicate signals</span> : null}
        {need.linkedBacklogItemId ? (
          <Link
            href={`/ops?itemId=${need.linkedBacklogItemId}`}
            className="text-[var(--dpf-accent)] hover:underline"
          >
            View backlog item {need.linkedBacklogItemId}
            {need.linkedBacklogItemTitle ? ` - ${need.linkedBacklogItemTitle}` : ""} →
          </Link>
        ) : null}
      </div>
    </article>
  );
}

function DetailBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-xs leading-5 text-[var(--dpf-muted)]">
      <div className="mb-1 font-semibold uppercase text-[var(--dpf-muted)]">{label}</div>
      {children}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--dpf-border)] px-2.5 py-1 text-xs font-medium text-[var(--dpf-text)]">
      {children}
    </span>
  );
}
