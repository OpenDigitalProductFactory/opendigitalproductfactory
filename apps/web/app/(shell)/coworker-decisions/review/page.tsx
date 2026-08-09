// EP-0AF96937 Phase 2: Decision Review & Adjust workspace.
// A findings surface over the accumulating decision ledger (not a log
// firehose): conflicts the gate flagged, and clusters of unresolved decisions
// where the doctrine has no settled answer yet. Each finding carries a
// plain-language action. Server component; queries Prisma directly.

import Link from "next/link";
import { prisma, Prisma } from "@dpf/db";

import {
  buildReviewFindings,
  type ConflictRow,
  type DriftRow,
  type GapCluster,
  type ReviewFinding,
} from "@/lib/wiki/decision-review-findings";
import {
  type ParsedPrinciplePage,
  selectKernelCommandments,
} from "@/lib/decision/golden-decisions";
import { evaluateGoldenDrift, driftedScenarios } from "@/lib/decision/decision-drift";
import {
  OrgDecisionCaptureList,
  type OpenOrgDecision,
} from "@/components/wiki/OrgDecisionCaptureList";
import { GapAnswerForm } from "./gap-answer-form";
import { WeightProposalForm } from "./weight-proposal-form";
import { listOpenWeightAdjustmentProposals } from "@/lib/decision-perspective/weight-proposal-store";
import { clusterDecisionReviewRows } from "@/lib/decision/review-identity";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Decision review",
};

const UNRESOLVED = ["defer", "escalate"];

const OPERATOR_ACTIONABLE_WHERE: Prisma.DecisionInteractionWhereInput = {
  question: { not: "" },
  // DB pushdown keeps `take` meaningful. `buildConflictFindings` still applies
  // isFounderActionable as the authoritative defense-in-depth predicate.
  NOT: [
    { gateKey: "profession" },
    { buildId: null, taskRunId: null, routeContext: { startsWith: "mcp:principle_decide" } },
    { buildId: null, taskRunId: null, domainClass: "kernel-consult" },
  ],
};

const CLASS_LABEL: Record<ReviewFinding["findingClass"], string> = {
  conflict: "conflict",
  drift: "drift",
  gap: "gap",
  staleness: "stale",
  "weight-proposal": "weight proposal",
};

// Semantic accent per finding class, via theme tokens (no hardcoded colors).
const CLASS_ACCENT: Record<ReviewFinding["findingClass"], string> = {
  conflict: "var(--dpf-error)",
  drift: "var(--dpf-error)",
  gap: "var(--dpf-accent)",
  staleness: "var(--dpf-warning)",
  "weight-proposal": "var(--dpf-accent)",
};

function toGapClusters(
  rows: { domainClass: string; question: string; profileId: string }[],
  orgProfileId: string | null,
): GapCluster[] {
  const byDomain = new Map<
    string,
    { count: number; sampleQuestion: string; scope: "org" | "kernel" }
  >();
  for (const row of rows) {
    const scope: "org" | "kernel" =
      orgProfileId && row.profileId === orgProfileId ? "org" : "kernel";
    const existing = byDomain.get(row.domainClass);
    if (existing) {
      existing.count += 1;
      // A domain is answerable if any of its deferrals were the org's own call.
      if (scope === "org") existing.scope = "org";
    } else {
      byDomain.set(row.domainClass, {
        count: 1,
        sampleQuestion: row.question,
        scope,
      });
    }
  }
  return [...byDomain.entries()].map(([domainClass, v]) => ({
    domainClass,
    count: v.count,
    sampleQuestion: v.sampleQuestion,
    scope: v.scope,
  }));
}

export default async function DecisionReviewPage() {
  const [
    conflictRows,
    unresolvedRows,
    staleCount,
    orgProfile,
    openOrgRows,
    principleRows,
    weightProposalRows,
  ] = await Promise.all([
      prisma.decisionInteraction.findMany({
        where: {
          principleConflict: true,
          humanOutcome: { equals: Prisma.DbNull },
          ...OPERATOR_ACTIONABLE_WHERE,
        },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          interactionId: true,
          question: true,
          riskTier: true,
          createdAt: true,
          humanOutcome: true,
          buildId: true,
          taskRunId: true,
          routeContext: true,
          domainClass: true,
          gateKey: true,
        },
      }),
      prisma.decisionInteraction.findMany({
        // Only rows the operator hasn't already answered (humanOutcome null) —
        // once answered via the loop below they resolve and drop off.
        where: {
          outcomeType: { in: UNRESOLVED },
          humanOutcome: { equals: Prisma.DbNull },
          ...OPERATOR_ACTIONABLE_WHERE,
        },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { domainClass: true, question: true, profileId: true },
      }),
      prisma.perspectiveMaterial.count({ where: { freshness: "stale" } }),
      prisma.decisionPerspectiveProfile.findFirst({
        where: { kind: "organization" },
        select: { profileId: true },
      }),
      // Unresolved WWWD business decisions (no build, unanswered) — the
      // inline capture loop's inbox (BI-9677364B).
      prisma.decisionInteraction.findMany({
        where: {
          outcomeType: { in: UNRESOLVED },
          buildId: null,
          routeContext: "/coworker-business",
          humanOutcome: { equals: Prisma.DbNull },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          interactionId: true,
          profileId: true,
          domainClass: true,
          question: true,
          riskTier: true,
          outcomeType: true,
          createdAt: true,
          scoredOptions: true,
          recommendedOptionId: true,
        },
      }),
      // Live kernel commandment corpus — the input the golden-decision drift
      // check re-scores against. Only commandments carry a signed vector today
      // (see selectKernelCommandments), so that is all we need to detect a flip.
      prisma.wikiPage.findMany({
        where: {
          organizationId: null,
          pageKind: "principle",
          principleTier: "commandment",
          status: "published",
        },
        select: {
          slug: true,
          principleAppliesTo: true,
          principleDimensionVector: true,
          principleWeight: true,
        },
      }),
      listOpenWeightAdjustmentProposals(prisma),
    ]);

  // Re-score the canonical decisions against the current corpus and surface any
  // that flipped or fell to a coin-flip (spec §4.3).
  const principlePages: ParsedPrinciplePage[] = principleRows.map((p) => ({
    slug: p.slug,
    principleTier: "commandment",
    principleAppliesTo: p.principleAppliesTo ?? [],
    principleDimensionVector:
      (p.principleDimensionVector as Record<string, number> | null) ?? undefined,
    principleWeight: p.principleWeight ?? undefined,
  }));
  const driftRows: DriftRow[] = driftedScenarios(
    evaluateGoldenDrift(selectKernelCommandments(principlePages)),
  ).map((d) => ({
    scenarioId: d.scenarioId,
    rationale: d.rationale,
    expectedWinner: d.expectedWinner,
    actualWinner: d.actualWinner,
    margin: d.margin,
    marginFloor: d.marginFloor,
    driftKind: d.driftKind ?? "flip",
  }));

  const openOrgDecisions: OpenOrgDecision[] = clusterDecisionReviewRows(openOrgRows).map((row) => ({
    interactionId: row.interactionId,
    question: row.question,
    riskTier: row.riskTier,
    outcomeType: row.outcomeType,
    createdAt: row.createdAt.toISOString(),
    scoredOptions: Array.isArray(row.scoredOptions)
      ? (row.scoredOptions as Array<{ id?: unknown; description?: unknown }>)
        .filter((option) => typeof option?.id === "string" && typeof option?.description === "string")
        .map((option) => ({ id: option.id as string, description: option.description as string }))
      : null,
    recommendedOptionId: row.recommendedOptionId ?? null,
    occurrenceCount: row.occurrenceCount,
  }));

  const findings = buildReviewFindings({
    conflicts: conflictRows as ConflictRow[],
    drift: driftRows,
    gapClusters: toGapClusters(unresolvedRows, orgProfile?.profileId ?? null),
    staleMaterial: { count: staleCount },
    weightProposals: weightProposalRows,
  });

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      <nav className="mb-6 flex items-center gap-2 text-sm text-[var(--dpf-muted)]">
        <Link href="/coworker-decisions" className="hover:text-[var(--dpf-text)]">
          Coworker Decision Engine
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
          — resolve clashing principles, cover the gaps where it has no settled
          answer yet, and catch when a doctrine change quietly flips a canonical
          call.
        </p>
      </header>

      <OrgDecisionCaptureList decisions={openOrgDecisions} />

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
                {f.action && (
                  <Link
                    href={f.action.href}
                    title={f.action.outcome}
                    className="rounded-md border border-[var(--dpf-border)] px-2.5 py-1 text-xs text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] shrink-0"
                  >
                    {f.action.label} →
                  </Link>
                )}
              </div>
              {f.detail && (
                <p className="text-xs text-[var(--dpf-muted)] mt-1.5 ml-1">{f.detail}</p>
              )}
              {f.answer && (
                <GapAnswerForm
                  domainClass={f.answer.domainClass}
                  question={f.answer.question}
                />
              )}
              {f.weightProposal && (
                <WeightProposalForm proposalId={f.weightProposal.proposalId} />
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8 flex items-center justify-between gap-3 rounded-lg border border-[var(--dpf-border)] p-4">
        <div>
          <p className="text-sm font-medium text-[var(--dpf-text)]">
            The decision matrix
          </p>
          <p className="text-xs text-[var(--dpf-muted)] mt-0.5">
            The axes and tier weights every principle is scored on. Review them
            when the criteria themselves need re-visiting or de-conflicting.
          </p>
        </div>
        <Link
          href="/coworker-decisions/matrix"
          className="text-sm text-[var(--dpf-accent)] hover:underline shrink-0"
        >
          View the matrix →
        </Link>
      </div>

    </div>
  );
}
