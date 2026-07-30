import Link from "next/link";
import { AskCoworkerButton } from "@/components/agent/AskCoworkerButton";
import { Notice, StatCard, StatusBadge } from "@/components/ui/report-kit";
import {
  createProductRoadmapSnapshot,
  PRODUCT_ROADMAP_AUDIENCES,
  PRODUCT_ROADMAP_LANES,
  PRODUCT_ROADMAP_VIEWS,
  type ProductRoadmapAudience,
  type ProductRoadmapItem,
  type ProductRoadmapView,
} from "@/lib/product-management/product-roadmap";
import type { ProductRoadmapWorkspace } from "@/lib/product-management/product-roadmap-operating-context";
import { ProductRoadmapExport } from "./ProductRoadmapExport";

const VIEW_LABELS: Record<ProductRoadmapView, string> = {
  sequence: "Now / Next / Later",
  timeline: "Timeline",
  outcomes: "Outcomes",
  dependencies: "Dependencies",
};

const AUDIENCE_LABELS: Record<ProductRoadmapAudience, string> = {
  "owner-operator": "Owner view",
  "product-manager": "Product manager",
  stakeholder: "Stakeholder",
};

const LANE_COPY = {
  now: {
    title: "Now",
    description: "Funded, objective-linked work with active delivery evidence.",
  },
  next: {
    title: "Next",
    description: "Funded, objective-linked work ready to sequence.",
  },
  later: {
    title: "Later",
    description:
      "Committed work held by low confidence, dependencies, or constraints.",
  },
} as const;

function queryHref(
  scopeHref: string,
  view: ProductRoadmapView,
  audience: ProductRoadmapAudience,
): string {
  const query = new URLSearchParams({ view, audience });
  return `${scopeHref}?${query.toString()}`;
}

function confidenceIntent(
  confidence: ProductRoadmapItem["confidence"],
): "success" | "warning" | "danger" | "neutral" {
  if (confidence === "high") return "success";
  if (confidence === "medium") return "warning";
  if (confidence === "low") return "danger";
  return "neutral";
}

function RoadmapCard({
  item,
  audience,
}: {
  item: ProductRoadmapItem;
  audience: ProductRoadmapAudience;
}) {
  return (
    <li className="rounded-dpf-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-dpf-md">
      <div className="flex flex-wrap items-start justify-between gap-dpf-sm">
        <div>
          <h3 className="text-dpf-body-lg font-dpf-semibold text-[var(--dpf-text)]">
            {item.title}
          </h3>
          <p className="mt-dpf-2xs text-dpf-caption text-[var(--dpf-muted)]">
            {item.id}
          </p>
        </div>
        <StatusBadge
          label={`${item.confidence} confidence`}
          intent={confidenceIntent(item.confidence)}
        />
      </div>
      <p className="mt-dpf-sm text-dpf-body text-[var(--dpf-muted)]">
        Outcome: {item.objectiveTitles.join(", ")}
      </p>
      {item.blockers.length > 0 ? (
        <ul
          className="mt-dpf-sm space-y-dpf-xs text-dpf-body text-[var(--dpf-error)]"
          aria-label="Roadmap blockers"
        >
          {item.blockers.map((blocker) => (
            <li key={`${item.id}:${blocker.code}:${blocker.sourceId}`}>
              <span className="font-dpf-medium">Blocked:</span>{" "}
              {blocker.summary}
            </li>
          ))}
        </ul>
      ) : null}
      {audience !== "owner-operator" ? (
        <dl className="mt-dpf-md grid gap-dpf-sm text-dpf-caption sm:grid-cols-2">
          <div>
            <dt className="font-dpf-medium text-[var(--dpf-text)]">
              Investment
            </dt>
            <dd className="text-[var(--dpf-muted)]">
              {item.investmentBucket ?? "Not classified"}
              {item.score === null ? "" : ` · score ${item.score}`}
            </dd>
          </div>
          <div>
            <dt className="font-dpf-medium text-[var(--dpf-text)]">
              Last movement
            </dt>
            <dd className="text-[var(--dpf-muted)]">
              {item.movement.summary}
            </dd>
          </div>
        </dl>
      ) : null}
      <Link
        href={item.canonicalHref}
        className="mt-dpf-md inline-flex text-dpf-body font-dpf-medium text-[var(--dpf-accent)] hover:underline"
      >
        Review canonical demand
      </Link>
    </li>
  );
}

function SequenceView({
  workspace,
  audience,
}: {
  workspace: ProductRoadmapWorkspace;
  audience: ProductRoadmapAudience;
}) {
  const { roadmap } = workspace;
  const committedCount = PRODUCT_ROADMAP_LANES.reduce(
    (count, lane) => count + roadmap.lanes[lane].length,
    0,
  );

  if (committedCount === 0) {
    return (
      <Notice variant="info" title="No committed roadmap bets yet">
        Work appears here only after governed funding and an explicit link to an
        active product objective. Unclassified or incomplete records remain in
        the readiness queue below.
      </Notice>
    );
  }

  return (
    <div className="grid gap-dpf-lg xl:grid-cols-3">
      {PRODUCT_ROADMAP_LANES.map((lane) => (
        <section
          key={lane}
          aria-labelledby={`roadmap-lane-${lane}`}
          className="min-w-0"
        >
          <div className="mb-dpf-md">
            <h2
              id={`roadmap-lane-${lane}`}
              className="text-dpf-title font-dpf-semibold text-[var(--dpf-text)]"
            >
              {LANE_COPY[lane].title}
              <span className="ml-dpf-xs text-dpf-body font-dpf-normal text-[var(--dpf-muted)]">
                {roadmap.lanes[lane].length}
              </span>
            </h2>
            <p className="mt-dpf-xs text-dpf-body text-[var(--dpf-muted)]">
              {LANE_COPY[lane].description}
            </p>
          </div>
          {roadmap.lanes[lane].length > 0 ? (
            <ul className="space-y-dpf-md">
              {roadmap.lanes[lane].map((item) => (
                <RoadmapCard key={item.id} item={item} audience={audience} />
              ))}
            </ul>
          ) : (
            <p className="rounded-dpf-lg border border-dashed border-[var(--dpf-border)] p-dpf-md text-dpf-body text-[var(--dpf-muted)]">
              No work currently qualifies for this lane.
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

function TimelineView({ workspace }: { workspace: ProductRoadmapWorkspace }) {
  const coordinationDates = workspace.roadmap.coordinationEvidence.flatMap(
    (evidence) => {
      if (evidence.kind !== "delivery") return [];
      return [
        {
          id: `${evidence.id}:planned-start`,
          title: evidence.title,
          date: evidence.plannedStartAt ?? null,
          kind: "planned start",
          sourceId: evidence.id,
        },
        {
          id: `${evidence.id}:planned-end`,
          title: evidence.title,
          date: evidence.plannedEndAt ?? null,
          kind: "planned end",
          sourceId: evidence.id,
        },
      ].filter(
        (
          entry,
        ): entry is {
          id: string;
          title: string;
          date: Date;
          kind: string;
          sourceId: string;
        } => entry.date instanceof Date,
      );
    },
  );
  if (
    workspace.roadmap.timeline.length === 0 &&
    coordinationDates.length === 0
  ) {
    return (
      <Notice variant="info" title="No supported roadmap dates">
        Sequence remains visible in Now / Next / Later. Timeline dates appear
        only after a linked delivery or release record supplies a real date.
      </Notice>
    );
  }
  return (
    <div className="space-y-dpf-lg">
      {workspace.roadmap.timeline.length > 0 ? (
        <section aria-labelledby="roadmap-timeline-title">
          <h2
            id="roadmap-timeline-title"
            className="text-dpf-title font-dpf-semibold text-[var(--dpf-text)]"
          >
            Evidence-backed timeline
          </h2>
          <ol className="mt-dpf-md space-y-dpf-md border-l border-[var(--dpf-border)] pl-dpf-lg">
            {workspace.roadmap.timeline.map((entry) => (
              <li key={entry.id} className="relative">
                <span
                  aria-hidden="true"
                  className="absolute -left-7 top-dpf-xs size-2 rounded-full bg-[var(--dpf-accent)]"
                />
                <time
                  dateTime={entry.date.toISOString()}
                  className="text-dpf-caption font-dpf-medium text-[var(--dpf-muted)]"
                >
                  {entry.date.toLocaleDateString()} · {entry.dateKind}
                </time>
                <h3 className="mt-dpf-2xs text-dpf-body-lg font-dpf-semibold text-[var(--dpf-text)]">
                  {entry.title}
                </h3>
                <p className="text-dpf-caption text-[var(--dpf-muted)]">
                  Source {entry.sourceId} · {entry.confidence} confidence
                </p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {coordinationDates.length > 0 ? (
        <section aria-labelledby="roadmap-unallocated-delivery">
          <h2
            id="roadmap-unallocated-delivery"
            className="text-dpf-title font-dpf-semibold text-[var(--dpf-text)]"
          >
            Delivery windows awaiting bet linkage
          </h2>
          <p className="mt-dpf-xs max-w-prose text-dpf-body text-[var(--dpf-muted)]">
            These are real change dates, but no canonical relation currently
            allocates them to one roadmap bet.
          </p>
          <ul className="mt-dpf-md grid gap-dpf-sm md:grid-cols-2">
            {coordinationDates.map((entry) => (
              <li
                key={entry.id}
                className="rounded-dpf-md border border-[var(--dpf-border)] p-dpf-md"
              >
                <time
                  dateTime={entry.date.toISOString()}
                  className="text-dpf-caption font-dpf-medium text-[var(--dpf-muted)]"
                >
                  {entry.date.toLocaleDateString()} · {entry.kind}
                </time>
                <p className="mt-dpf-2xs text-dpf-body font-dpf-medium text-[var(--dpf-text)]">
                  {entry.title}
                </p>
                <p className="text-dpf-caption text-[var(--dpf-muted)]">
                  Source {entry.sourceId}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function OutcomeView({ workspace }: { workspace: ProductRoadmapWorkspace }) {
  if (workspace.roadmap.outcomes.length === 0) {
    return (
      <Notice variant="info" title="No active objective-linked bets">
        Activate a product objective and explicitly link funded work to see an
        outcome roadmap.
      </Notice>
    );
  }
  return (
    <div className="grid gap-dpf-md lg:grid-cols-2">
      {workspace.roadmap.outcomes.map((outcome) => (
        <section
          key={outcome.objectiveId}
          aria-labelledby={`roadmap-outcome-${outcome.objectiveId}`}
          className="rounded-dpf-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-dpf-lg"
        >
          <h2
            id={`roadmap-outcome-${outcome.objectiveId}`}
            className="text-dpf-title font-dpf-semibold text-[var(--dpf-text)]"
          >
            {outcome.title}
          </h2>
          <p className="mt-dpf-xs text-dpf-caption text-[var(--dpf-muted)]">
            {outcome.objectiveId} · {outcome.confidence} confidence
          </p>
          <ul className="mt-dpf-md space-y-dpf-sm text-dpf-body text-[var(--dpf-text)]">
            {outcome.itemIds.map((itemId) => (
              <li key={itemId}>{itemId}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function DependencyView({
  workspace,
}: {
  workspace: ProductRoadmapWorkspace;
}) {
  const architecture = workspace.roadmap.coordinationEvidence.filter(
    (evidence) => evidence.kind === "architecture",
  );
  return (
    <div className="space-y-dpf-lg">
      {workspace.roadmap.dependencies.length > 0 ? (
        <section aria-labelledby="roadmap-work-dependencies">
          <h2
            id="roadmap-work-dependencies"
            className="text-dpf-title font-dpf-semibold text-[var(--dpf-text)]"
          >
            Work dependencies
          </h2>
          <ul className="mt-dpf-md space-y-dpf-sm">
            {workspace.roadmap.dependencies.map((dependency) => (
              <li
                key={dependency.id}
                className="rounded-dpf-md border border-[var(--dpf-border)] p-dpf-md text-dpf-body"
              >
                {dependency.fromItemId} depends on {dependency.toItemId}
                {dependency.cyclic ? " · cycle detected" : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <Notice variant="info" title="No canonical work dependency links">
          Digital-product architecture edges are shown separately below. They
          are not converted into backlog dependencies without an explicit
          association.
        </Notice>
      )}
      <section aria-labelledby="roadmap-architecture-coordination">
        <h2
          id="roadmap-architecture-coordination"
          className="text-dpf-title font-dpf-semibold text-[var(--dpf-text)]"
        >
          Architecture coordination
        </h2>
        {architecture.length > 0 ? (
          <ul className="mt-dpf-md space-y-dpf-sm">
            {architecture.map((evidence) => (
              <li
                key={evidence.id}
                className="rounded-dpf-md border border-[var(--dpf-border)] p-dpf-md"
              >
                <p className="text-dpf-body font-dpf-medium text-[var(--dpf-text)]">
                  {evidence.title}
                </p>
                <p className="mt-dpf-2xs text-dpf-caption text-[var(--dpf-muted)]">
                  {evidence.status} · source {evidence.id}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-dpf-md text-dpf-body text-[var(--dpf-muted)]">
            No explicitly associated architecture evidence is available.
          </p>
        )}
      </section>
    </div>
  );
}

function ReadinessQueue({
  workspace,
}: {
  workspace: ProductRoadmapWorkspace;
}) {
  if (workspace.roadmap.readiness.length === 0) return null;
  return (
    <section aria-labelledby="roadmap-readiness-title">
      <h2
        id="roadmap-readiness-title"
        className="text-dpf-title font-dpf-semibold text-[var(--dpf-text)]"
      >
        Needs evidence before commitment
      </h2>
      <p className="mt-dpf-xs max-w-prose text-dpf-body text-[var(--dpf-muted)]">
        These records are not roadmap bets. Resolve the named canonical
        boundary; the projection will update automatically.
      </p>
      <ul className="mt-dpf-md grid gap-dpf-md lg:grid-cols-2">
        {workspace.roadmap.readiness.map((item) => (
          <li
            key={`${item.id}:${item.code}`}
            className="rounded-dpf-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-dpf-md"
          >
            <h3 className="text-dpf-body-lg font-dpf-semibold text-[var(--dpf-text)]">
              {item.title}
            </h3>
            <p className="mt-dpf-xs text-dpf-body text-[var(--dpf-muted)]">
              {item.reason}
            </p>
            <Link
              href={item.actionHref}
              className="mt-dpf-sm inline-flex text-dpf-body font-dpf-medium text-[var(--dpf-accent)] hover:underline"
            >
              {item.actionLabel}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ProductRoadmap({
  scopeId,
  scopeHref,
  workspace,
  view,
  audience,
}: {
  scopeId: string;
  scopeHref: string;
  workspace: ProductRoadmapWorkspace;
  view: ProductRoadmapView;
  audience: ProductRoadmapAudience;
}) {
  const { roadmap } = workspace;
  const committedCount = PRODUCT_ROADMAP_LANES.reduce(
    (count, lane) => count + roadmap.lanes[lane].length,
    0,
  );
  const snapshot = createProductRoadmapSnapshot(roadmap, { view, audience });
  const routeContext = scopeHref;

  return (
    <div className="space-y-dpf-xl">
      <header className="flex flex-col gap-dpf-md lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-dpf-caption font-dpf-medium uppercase tracking-wide text-[var(--dpf-muted)]">
            Product direction
          </p>
          <h1 className="mt-dpf-xs text-dpf-heading font-dpf-semibold text-[var(--dpf-text)]">
            {roadmap.scope.name} roadmap
          </h1>
          <p className="mt-dpf-sm max-w-prose text-dpf-body-lg text-[var(--dpf-muted)]">
            A current projection from funded demand, active objectives, and
            delivery evidence. Change the source record—not this view.
          </p>
        </div>
        <div className="flex flex-wrap gap-dpf-sm">
          <AskCoworkerButton
            label="Review with coworker"
            routeContext={routeContext}
            prompt="Review this product roadmap with the relevant stakeholders. Explain committed bets, readiness gaps, confidence, unsupported dates, and architecture coordination. Use the existing organization decision/audit substrate for any recorded review; do not create or edit a separate roadmap authority."
            confirmation={{
              title: "Review the current projection",
              contextSummary:
                "Current roadmap filters, source-backed bets, readiness gaps, and coordination evidence.",
              expectedNextStep:
                "The coworker explains the evidence and previews any governed stakeholder-review record.",
              confirmLabel: "Open review",
            }}
            className="rounded-dpf-md bg-[var(--dpf-accent)] px-dpf-md py-dpf-sm text-dpf-body font-dpf-medium text-[var(--dpf-surface-1)]"
          />
          <ProductRoadmapExport
            snapshot={snapshot}
            fileName={`product-roadmap-${scopeId}-${roadmap.asOf.toISOString().slice(0, 10)}.json`}
          />
        </div>
      </header>

      <div className="grid gap-dpf-md sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Committed bets"
          value={committedCount}
          hint="Funded and linked to an active objective"
        />
        <StatCard
          label="In delivery"
          value={roadmap.lanes.now.length}
          hint="Current Now lane"
        />
        <StatCard
          label="Needs evidence"
          value={roadmap.readiness.length}
          hint="Not counted as roadmap commitments"
        />
        <StatCard
          label="Projection confidence"
          value={roadmap.confidence}
          hint={`As of ${roadmap.asOf.toLocaleString()}`}
        />
      </div>

      <nav aria-label="Roadmap audience" className="flex flex-wrap gap-dpf-xs">
        {PRODUCT_ROADMAP_AUDIENCES.map((candidate) => (
          <Link
            key={candidate}
            href={queryHref(scopeHref, view, candidate)}
            aria-current={candidate === audience ? "page" : undefined}
            className={
              candidate === audience
                ? "rounded-full bg-[var(--dpf-text)] px-dpf-md py-dpf-xs text-dpf-caption font-dpf-medium text-[var(--dpf-bg)]"
                : "rounded-full border border-[var(--dpf-border)] px-dpf-md py-dpf-xs text-dpf-caption text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
            }
          >
            {AUDIENCE_LABELS[candidate]}
          </Link>
        ))}
      </nav>

      <nav
        aria-label="Roadmap view"
        className="border-b border-[var(--dpf-border)]"
      >
        <ul className="flex gap-dpf-lg overflow-x-auto">
          {PRODUCT_ROADMAP_VIEWS.map((candidate) => (
            <li key={candidate}>
              <Link
                href={queryHref(scopeHref, candidate, audience)}
                aria-current={candidate === view ? "page" : undefined}
                className={
                  candidate === view
                    ? "inline-flex border-b-2 border-[var(--dpf-accent)] px-dpf-2xs pb-dpf-sm text-dpf-body font-dpf-semibold text-[var(--dpf-text)]"
                    : "inline-flex px-dpf-2xs pb-dpf-sm text-dpf-body text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
                }
              >
                {VIEW_LABELS[candidate]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {view === "sequence" ? (
        <SequenceView workspace={workspace} audience={audience} />
      ) : null}
      {view === "timeline" ? <TimelineView workspace={workspace} /> : null}
      {view === "outcomes" ? <OutcomeView workspace={workspace} /> : null}
      {view === "dependencies" ? (
        <DependencyView workspace={workspace} />
      ) : null}

      <ReadinessQueue workspace={workspace} />

      {audience !== "owner-operator" ? (
        <details className="rounded-dpf-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-dpf-md">
          <summary className="cursor-pointer text-dpf-body font-dpf-semibold text-[var(--dpf-text)]">
            Source posture and projection boundary
          </summary>
          <dl className="mt-dpf-md grid gap-dpf-md sm:grid-cols-2 xl:grid-cols-4">
            {Object.entries(workspace.sources).map(([source, posture]) => (
              <div key={source}>
                <dt className="capitalize font-dpf-medium text-[var(--dpf-text)]">
                  {source}
                </dt>
                <dd className="mt-dpf-2xs text-dpf-caption text-[var(--dpf-muted)]">
                  {posture.availability} · {posture.freshness} · {posture.count}{" "}
                  records
                  {posture.reason ? ` · ${posture.reason}` : ""}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-dpf-md text-dpf-caption text-[var(--dpf-muted)]">
            Business Product roadmaps do not make DigitalProduct dependencies
            or change records into commercial planning authority. Snapshot
            exports are timestamped evidence packets and cannot be imported.
          </p>
        </details>
      ) : null}
    </div>
  );
}
