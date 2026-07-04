// EP-0AF96937 Phase 2: Decision Review & Adjust workspace.
// A findings surface over the accumulating decision ledger (not a log
// firehose): conflicts the gate flagged, and clusters of unresolved decisions
// where the doctrine has no settled answer yet. Each finding carries a
// plain-language action. Server component; queries Prisma directly.

import Link from "next/link";
import { prisma } from "@dpf/db";

import {
  buildReviewFindings,
  type ConflictRow,
  type GapCluster,
  type ReviewFinding,
} from "@/lib/wiki/decision-review-findings";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Decision review",
};

const UNRESOLVED = ["defer", "escalate"];

const CLASS_LABEL: Record<ReviewFinding["findingClass"], string> = {
  conflict: "conflict",
  gap: "gap",
};

// Semantic accent per finding class, via theme tokens (no hardcoded colors).
const CLASS_ACCENT: Record<ReviewFinding["findingClass"], string> = {
  conflict: "var(--dpf-error)",
  gap: "var(--dpf-accent)",
};

function toGapClusters(
  rows: { domainClass: string; question: string }[],
): GapCluster[] {
  const byDomain = new Map<string, { count: number; sampleQuestion: string }>();
  for (const row of rows) {
    const existing = byDomain.get(row.domainClass);
    if (existing) {
      existing.count += 1;
    } else {
      byDomain.set(row.domainClass, { count: 1, sampleQuestion: row.question });
    }
  }
  return [...byDomain.entries()].map(([domainClass, v]) => ({
    domainClass,
    count: v.count,
    sampleQuestion: v.sampleQuestion,
  }));
}

export default async function DecisionReviewPage() {
  const [conflictRows, unresolvedRows] = await Promise.all([
    prisma.decisionInteraction.findMany({
      where: { principleConflict: true },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        interactionId: true,
        question: true,
        riskTier: true,
        createdAt: true,
      },
    }),
    prisma.decisionInteraction.findMany({
      where: { outcomeType: { in: UNRESOLVED } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { domainClass: true, question: true },
    }),
  ]);

  const findings = buildReviewFindings({
    conflicts: conflictRows as ConflictRow[],
    gapClusters: toGapClusters(unresolvedRows),
  });

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      <nav className="mb-6 flex items-center gap-2 text-sm text-[var(--dpf-muted)]">
        <Link href="/wiki" className="hover:text-[var(--dpf-text)]">
          Decision governance
        </Link>
        <span>/</span>
        <span className="text-[var(--dpf-text)] font-medium">Review &amp; adjust</span>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--dpf-text)] mb-1">
          Review &amp; adjust
        </h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          As your AI makes decisions, this is where you keep the governance sharp
          — resolve clashing principles and cover the gaps where it has no
          settled answer yet.
        </p>
      </header>

      {findings.length === 0 ? (
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-8 text-center">
          <p className="text-sm text-[var(--dpf-text)]">Nothing to review right now.</p>
          <p className="text-xs text-[var(--dpf-muted)] mt-1">
            No conflicting principles and no clusters of unresolved decisions.
            Findings appear here as decisions accumulate.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {findings.map((f) => (
            <li
              key={f.id}
              className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3"
              style={{ borderLeftWidth: "3px", borderLeftColor: CLASS_ACCENT[f.findingClass] }}
            >
              <div className="flex items-center gap-3 flex-wrap">
                <span
                  className="rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                  style={{ color: CLASS_ACCENT[f.findingClass], border: `1px solid ${CLASS_ACCENT[f.findingClass]}` }}
                >
                  {CLASS_LABEL[f.findingClass]}
                </span>
                <span className="text-sm font-medium text-[var(--dpf-text)] min-w-0 flex-1">
                  {f.title}
                </span>
                {f.postureLabel && (
                  <span className="text-xs text-[var(--dpf-muted)] shrink-0">
                    {f.postureLabel}
                  </span>
                )}
                <Link
                  href={f.actionHref}
                  className="rounded-md border border-[var(--dpf-border)] px-2.5 py-1 text-xs text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] shrink-0"
                >
                  {f.actionLabel} →
                </Link>
              </div>
              {f.detail && (
                <p className="text-xs text-[var(--dpf-muted)] mt-1.5 ml-1">{f.detail}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-[var(--dpf-muted)] mt-8">
        Coming next: golden-decision drift alerts, stale-material review, and the
        principle-dimension matrix — see the{" "}
        <span className="font-mono">decision-governance</span> design.
      </p>
    </div>
  );
}
