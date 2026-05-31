import { prisma } from "@dpf/db";
import Link from "next/link";
import {
  groupFounderReviewCandidates,
  projectFounderReviewCandidate,
  type DecisionPerspectiveMode,
  type DecisionInteractionQueueRow,
} from "@/lib/founder-review/queue";

type PageProps = {
  searchParams?: Promise<{ mode?: string }>;
};

function normalizeMode(value: string | undefined): DecisionPerspectiveMode | null {
  return value === "wwmd" || value === "wwwd" || value === "custom" ? value : null;
}

function titleForMode(mode: DecisionPerspectiveMode | null) {
  if (mode === "wwwd" || mode === "custom") return "Owner/Operator Review";
  return "Founder Review";
}

export default async function FounderReviewPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await (searchParams ?? Promise.resolve({} as { mode?: string }));
  const mode = normalizeMode(resolvedSearchParams.mode);
  const rows = await prisma.decisionInteraction.findMany({
    where: {
      outcomeType: { in: ["defer", "escalate"] },
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
    .map((row) => projectFounderReviewCandidate(row as DecisionInteractionQueueRow))
    .filter((candidate) => !mode || candidate.perspectiveMode === mode);
  const groups = groupFounderReviewCandidates(candidates);
  const title = titleForMode(mode);

  return (
    <main className="space-y-6 text-[var(--dpf-text)]">
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          Unresolved decisions that need a principle, evidence, owner, or judgment call.
        </p>
      </div>

      {groups.length === 0 ? (
        <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <h2 className="text-sm font-semibold">No review items waiting</h2>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">Build Studio has no unresolved decision requests.</p>
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
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Link
                          className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
                          href={item.links.decisionCanvasHref}
                        >
                          View Decision Canvas
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
                        <button
                          className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-muted)]"
                          disabled
                          title="Record outcome is gated on the WWMD MCP Sprint 1 handler."
                          type="button"
                        >
                          Record outcome
                        </button>
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
