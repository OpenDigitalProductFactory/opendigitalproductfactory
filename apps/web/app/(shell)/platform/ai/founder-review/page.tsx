import { Prisma, prisma } from "@dpf/db";
import Link from "next/link";
import {
  dedupeFounderReviewCandidates,
  groupFounderReviewCandidates,
  isFounderActionable,
  isBlankFounderReviewQuestion,
  projectFounderReviewCandidate,
  type DecisionInteractionQueueRow,
} from "@/lib/founder-review/queue";
import type { WikiPerspective } from "@/lib/wiki/perspective-intent";
import { BandTelemetryPanel } from "@/components/platform/BandTelemetryPanel";
import { computeBandTelemetry, type BandTelemetryRow } from "@/lib/decision/band-telemetry";

type PageProps = {
  searchParams?: Promise<{ mode?: string; profile?: string }>;
};

// Mode filter only narrows to WWMD or WWWD — no `"custom"` literal. Use the
// canonical `WikiPerspective` enum from `lib/wiki/perspective-intent.ts`
// (PR #1343); a sibling string union is forbidden here.
function normalizeMode(value: string | undefined): WikiPerspective | null {
  return value === "wwmd" || value === "wwwd" ? value : null;
}

function titleForMode(mode: WikiPerspective | null) {
  if (mode === "wwwd") return "Owner/Operator Review";
  return "Founder Review";
}

const WORK_QUEUE_GUIDE = [
  {
    title: "Needs you",
    href: "/workspace/inbox",
    description: "Start here for approvals, paused coworkers, escalations, and anything blocking an owner decision.",
  },
  {
    title: "My queue",
    href: "/workspace/my-queue",
    description: "Your assigned work cases: things you or a teammate own through completion.",
  },
  {
    title: "Build Studio",
    href: "/build",
    description: "Product/build work in flight, including build-specific “Needs you” moments.",
  },
  {
    title: "Decision Governance",
    href: "/coworker-decisions/review",
    description: "Review and improve WWMD, WWWD, and role-craft decision rules after evidence is clear.",
  },
] as const;

export default async function FounderReviewPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await (searchParams ?? Promise.resolve({} as { mode?: string; profile?: string }));
  const mode = normalizeMode(resolvedSearchParams.mode);
  // Profession/coworker scoping (HRIS surface): the coworker record's Decisions
  // tab deep-links `?profile=<professionProfileId>` to filter this inbox to one
  // coworker's profession profile.
  const profileFilter = resolvedSearchParams.profile?.trim() || null;
  const rows = await prisma.decisionInteraction.findMany({
    where: {
      outcomeType: { in: ["defer", "escalate"] },
      humanOutcome: { equals: Prisma.DbNull },
      ...(profileFilter ? { profileId: profileFilter } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      interactionId: true,
      question: true,
      options: true,
      outcomeType: true,
      outcomePayload: true,
      buildId: true,
      taskRunId: true,
      routeContext: true,
      domainClass: true,
      gateKey: true,
      createdAt: true,
      profile: {
        select: {
          profileId: true,
          name: true,
          kind: true,
        },
      },
    },
  });

  const candidates = rows
    .filter((row) => !isBlankFounderReviewQuestion(row))
    .filter((row) => isFounderActionable(row))
    .map((row) => projectFounderReviewCandidate(row as DecisionInteractionQueueRow))
    .filter((candidate) => !mode || candidate.perspective === mode);
  const visibleCandidates = dedupeFounderReviewCandidates(candidates);
  const groups = groupFounderReviewCandidates(visibleCandidates);

  // BI-3217C098: the tuning instrument. Read-only aggregation over recorded
  // decisions; a failure here must not take down the review inbox.
  const telemetry = await (async () => {
    try {
      const rows = await prisma.decisionInteraction.findMany({
        where: profileFilter ? { profileId: profileFilter } : {},
        orderBy: { createdAt: "desc" },
        take: 500,
        select: {
          outcomePayload: true,
          recommendedOptionId: true,
          chosenOptionId: true,
        },
      });
      return computeBandTelemetry(rows.map((r) => {
        const payload = (r.outcomePayload ?? {}) as Record<string, unknown>;
        return {
          margin: typeof payload["margin"] === "number" ? payload["margin"] : null,
          verdict: (payload["verdict"] as BandTelemetryRow["verdict"]) ?? null,
          bandUpper: typeof payload["bandUpper"] === "number" ? payload["bandUpper"] : null,
          recommendedOptionId: r.recommendedOptionId,
          chosenOptionId: r.chosenOptionId,
        };
      }));
    } catch {
      return null;
    }
  })();
  const title = titleForMode(mode);

  return (
    <main className="space-y-6 text-[var(--dpf-text)]">
      {telemetry ? <BandTelemetryPanel telemetry={telemetry} /> : null}

      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          Filtered AI decision residue. Use Needs you as the main inbox for all approvals,
          paused coworkers, and decisions waiting on a person.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/workspace/inbox"
            className="rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-sm font-medium text-[var(--dpf-bg)]"
          >
            Open Needs you
          </Link>
          <Link
            href="/coworker-decisions/review"
            className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
          >
            Review decision governance
          </Link>
        </div>
        {profileFilter ? (
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            Filtered to profile <code>{profileFilter}</code> ·{" "}
            <Link href="/platform/ai/founder-review" className="text-[var(--dpf-accent)]">
              clear filter
            </Link>
          </p>
        ) : null}
      </div>

      <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">Where work lives</h2>
            <p className="mt-1 max-w-prose text-sm text-[var(--dpf-muted)]">
              You do not need to patrol every queue. Treat Needs you as the front door; use
              the other pages when you are already in that kind of work.
            </p>
          </div>
          <p className="text-xs text-[var(--dpf-muted)]">
            Showing {visibleCandidates.length} distinct review {visibleCandidates.length === 1 ? "item" : "items"}
            {" "}from {rows.length} unresolved AI decision {rows.length === 1 ? "row" : "rows"}.
          </p>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {WORK_QUEUE_GUIDE.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-bg)] p-3"
            >
              <span className="text-sm font-medium text-[var(--dpf-text)]">{item.title}</span>
              <span className="mt-1 block text-xs text-[var(--dpf-muted)]">{item.description}</span>
            </Link>
          ))}
        </div>
        <p className="mt-3 text-xs text-[var(--dpf-muted)]">
          These cards are created when an AI decision is deferred or escalated. Resolved
          history, blank questions, internal consults, and duplicate asks are hidden here.
        </p>
      </section>

      {groups.length === 0 ? (
        <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <h2 className="text-sm font-semibold">No review items waiting</h2>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">
            No unresolved AI decision residue matches this lens. The main attention queue is Needs you.
          </p>
        </section>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label} className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">{group.label}</h2>
                <span className="text-xs text-[var(--dpf-muted)]">{group.items.length} waiting</span>
              </div>
              <div className="grid gap-3">
                {group.items.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{item.question}</p>
                        <p className="mt-1 text-xs text-[var(--dpf-muted)]">{item.profileLabel}</p>
                        <p className="mt-2 text-sm text-[var(--dpf-muted)]">{item.primaryActionLabel}</p>
                        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                          Open the evidence, then record the outcome from the owning workflow.
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Link
                          className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
                          href={item.links.decisionCanvasHref}
                        >
                          Review evidence
                        </Link>
                        {item.links.buildHref ? (
                          <Link
                            className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
                            href={item.links.buildHref}
                          >
                            Open build
                          </Link>
                        ) : null}
                        {item.links.taskRunHref ? (
                          <Link
                            className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
                            href={item.links.taskRunHref}
                          >
                            Open task
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
