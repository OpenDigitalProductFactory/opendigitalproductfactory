import Link from "next/link";
import {
  linkCoworkerCapabilityNeedToBacklogAction,
  resolveCoworkerCapabilityNeedAction,
} from "@/lib/actions/coworker-capability-needs";
import {
  getCoworkerCapabilityNeedReview,
  parseCoworkerCapabilityNeedReviewFilters,
  type CoworkerCapabilityNeedReviewItem,
} from "@/lib/coworker-self-assessment/review-service";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const SUMMARY_LABELS = [
  { key: "total", label: "Total" },
  { key: "blocker", label: "Blockers" },
  { key: "submitted", label: "Submitted" },
  { key: "accepted", label: "Accepted" },
] as const;

export default async function CoworkerCapabilityNeedsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = parseCoworkerCapabilityNeedReviewFilters(params ?? {});
  const review = await getCoworkerCapabilityNeedReview(filters);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-[var(--dpf-muted)]">
            AI Operations
          </p>
          <h1 className="mt-1 text-xl font-bold text-[var(--dpf-text)]">Capability Needs</h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--dpf-muted)]">
            Review queue for AI coworker self-assessments, capability gaps, and submitted
            investment needs.
          </p>
        </div>
        <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-xs text-[var(--dpf-muted)]">
          Review queue
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SUMMARY_LABELS.map((item) => (
          <div
            key={item.key}
            className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3"
          >
            <div className="text-xs text-[var(--dpf-muted)]">{item.label}</div>
            <div className="mt-1 text-2xl font-semibold text-[var(--dpf-text)]">
              {summaryValue(item.key, review.summary)}
            </div>
          </div>
        ))}
      </section>

      <section className="flex flex-wrap gap-2">
        <FilterLink
          label="All"
          href="/platform/ai/capability-needs"
          active={!filters.status && !filters.severity && !filters.kind}
        />
        {review.filterOptions.statuses.map((status) => (
          <FilterLink
            key={status}
            label={status}
            href={`/platform/ai/capability-needs?status=${encodeURIComponent(status)}`}
            active={filters.status === status}
          />
        ))}
        {review.filterOptions.severities.map((severity) => (
          <FilterLink
            key={severity}
            label={severity}
            href={`/platform/ai/capability-needs?severity=${encodeURIComponent(severity)}`}
            active={filters.severity === severity}
          />
        ))}
        {review.filterOptions.kinds.map((kind) => (
          <FilterLink
            key={kind}
            label={kind}
            href={`/platform/ai/capability-needs?kind=${encodeURIComponent(kind)}`}
            active={filters.kind === kind}
          />
        ))}
      </section>

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

function summaryValue(
  key: typeof SUMMARY_LABELS[number]["key"],
  summary: Awaited<ReturnType<typeof getCoworkerCapabilityNeedReview>>["summary"],
) {
  if (key === "total") return summary.total;
  if (key === "blocker") return summary.bySeverity.blocker ?? 0;
  return summary.byStatus[key] ?? 0;
}

function FilterLink({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={[
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent)]/10 text-[var(--dpf-text)]"
          : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
      ].join(" ")}
    >
      {label}
    </Link>
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
        <div className="flex flex-wrap gap-2">
          <Badge>{need.severity}</Badge>
          <Badge>{need.kind}</Badge>
          <Badge>{need.status}</Badge>
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
          <span>
            Backlog {need.linkedBacklogItemId}
            {need.linkedBacklogItemTitle ? ` - ${need.linkedBacklogItemTitle}` : ""}
          </span>
        ) : null}
      </div>

      <ReviewControls need={need} />
    </article>
  );
}

function ReviewControls({ need }: { need: CoworkerCapabilityNeedReviewItem }) {
  return (
    <div className="mt-4 border-t border-[var(--dpf-border)] pt-4">
      <div className="mb-2 text-xs font-semibold uppercase text-[var(--dpf-muted)]">Review actions</div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]">
        <div className="flex flex-wrap gap-2">
          <DecisionForm needId={need.needId} status="accepted" label="Accept" />
          <DecisionForm needId={need.needId} status="deferred" label="Defer" />
          <DecisionForm needId={need.needId} status="discarded" label="Discard" />
        </div>

        <form action={linkCoworkerCapabilityNeedToBacklogAction} className="flex flex-col gap-2 sm:flex-row">
          <input type="hidden" name="needId" value={need.needId} />
          <input
            name="backlogItemId"
            placeholder="BI-F026ADD0"
            defaultValue={need.linkedBacklogItemId ?? ""}
            className="min-w-0 flex-1 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs text-[var(--dpf-text)]"
          />
          <button
            type="submit"
            className="rounded-md border border-[var(--dpf-accent)] px-3 py-2 text-xs font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-accent)]/10"
          >
            Link backlog item
          </button>
        </form>
      </div>

      <form action={resolveCoworkerCapabilityNeedAction} className="mt-3 grid gap-2 md:grid-cols-[180px_minmax(0,1fr)_auto]">
        <input type="hidden" name="needId" value={need.needId} />
        <input type="hidden" name="status" value="duplicate" />
        <input
          name="duplicateOfId"
          placeholder="Canonical need id"
          defaultValue={need.duplicateOfId ?? ""}
          className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs text-[var(--dpf-text)]"
        />
        <input
          name="reviewerNote"
          placeholder="Reviewer note"
          defaultValue={need.reviewerNote ?? ""}
          className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs text-[var(--dpf-text)]"
        />
        <button
          type="submit"
          className="rounded-md border border-[var(--dpf-border)] px-3 py-2 text-xs font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
        >
          Mark duplicate
        </button>
      </form>
    </div>
  );
}

function DecisionForm({
  needId,
  status,
  label,
}: {
  needId: string;
  status: "accepted" | "deferred" | "discarded";
  label: string;
}) {
  return (
    <form action={resolveCoworkerCapabilityNeedAction}>
      <input type="hidden" name="needId" value={needId} />
      <input type="hidden" name="status" value={status} />
      <button
        type="submit"
        className="rounded-md border border-[var(--dpf-border)] px-3 py-2 text-xs font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] hover:bg-[var(--dpf-accent)]/10"
      >
        {label}
      </button>
    </form>
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
