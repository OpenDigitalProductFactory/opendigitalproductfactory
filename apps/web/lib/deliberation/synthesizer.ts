// apps/web/lib/deliberation/synthesizer.ts
// Task 6 — Deliberation synthesizer (spec §6.1, §6.2, §13).
//
// Turns branch artifacts into:
//   - DeliberationOutcome  (merged recommendation, rationale, confidence,
//                           unresolved risks, consensusState, roster)
//   - DeliberationIssueSet (assertions, objections, rebuttals, notes)
//   - ClaimRecord rows     (each assertion/objection/rebuttal persisted)
//   - compact FeatureBuild.deliberationSummary patch
//
// Consensus rules (spec §13):
//   - no branch outputs at all                     → insufficient-evidence
//   - all surviving branches agree (recommendation) → consensus
//   - some agree, some disagree                    → partial-consensus
//   - all disagree                                  → no-consensus
//   - budget-halted + insufficient content survived → insufficient-evidence
//
// The synthesizer NEVER fabricates consensus from zero branches
// (memory: contribute_to_hive silent-success precedent).

import { prisma } from "@dpf/db";
import type {
  ClaimEvidenceGrade,
  ClaimType,
  DeliberationConsensusState,
} from "./types";
import { computeEvidenceBadge } from "./evidence";

/* -------------------------------------------------------------------------- */
/* Public shapes                                                              */
/* -------------------------------------------------------------------------- */

export interface BranchArtifact {
  branchNodeId: string;
  role: string;
  completed: boolean;
  /** Short free-text recommendation / position. Used for consensus detection
   *  via normalized-text similarity (lowercased, whitespace-collapsed). */
  recommendation?: string;
  /** Optional free-text rationale, surfaced in mergedRecommendation. */
  rationale?: string;
  /** Structured claims the branch produced. */
  assertions?: BranchClaim[];
  objections?: BranchClaim[];
  rebuttals?: BranchClaim[];
  failureReason?: string;
}

export interface BranchClaim {
  claimText: string;
  evidenceGrade: ClaimEvidenceGrade;
  confidence?: number;
  supportingSourceIds?: string[];
  opposingSourceIds?: string[];
}

export interface SynthesizeDeliberationInput {
  deliberationRunId: string;
  artifactType: string;
  branches: BranchArtifact[];
  /** True when orchestration halted due to budget cap — drives
   *  metadata.budgetHalted flag on the outcome row. */
  budgetHalted?: boolean;
  /** True when routing layer couldn't satisfy requested diversity. */
  degradedDiversity?: boolean;
  /** Optional human-facing label for the diversity the run actually used. */
  diversityLabel?: string;
}

export interface SynthesizedOutcome {
  deliberationRunId: string;
  mergedRecommendation: string;
  rationaleSummary: string;
  confidence: number;
  unresolvedRisks: string[];
  consensusState: DeliberationConsensusState;
  branchCompletionRoster: BranchRosterEntry[];
  metadata: {
    budgetHalted: boolean;
    degradedDiversity: boolean;
  };
}

export interface BranchRosterEntry {
  branchNodeId: string;
  role: string;
  completed: boolean;
  failureReason?: string;
}

export interface SynthesizedIssueSet {
  deliberationRunId: string;
  assertions: Array<{ claimId: string }>;
  objections: Array<{ claimId: string }>;
  rebuttals: Array<{ claimId: string }>;
  adjudicationNotes: string;
}

export interface CompactBuildDeliberationSummary {
  deliberationRunId: string;
  consensusState: DeliberationConsensusState;
  confidence: number;
  unresolvedCount: number;
  branchesCompleted: number;
  branchesTotal: number;
  budgetHalted: boolean;
  degradedDiversity: boolean;
  evidenceBadge: "source-backed" | "mixed" | "needs-more-evidence";
}

export interface SynthesizeResult {
  outcome: SynthesizedOutcome;
  issueSet: SynthesizedIssueSet;
  claimRecordIds: string[];
  compactSummary: CompactBuildDeliberationSummary;
}

/* -------------------------------------------------------------------------- */
/* Consensus detection                                                        */
/* -------------------------------------------------------------------------- */

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function detectConsensusState(
  branches: BranchArtifact[],
  budgetHalted: boolean,
): DeliberationConsensusState {
  const completed = branches.filter((b) => b.completed);

  // Zero surviving branches with any content — cannot fabricate consensus.
  if (completed.length === 0) return "insufficient-evidence";

  // Count how many branches gave an explicit recommendation.
  const withRec = completed.filter(
    (b) => typeof b.recommendation === "string" && b.recommendation.trim() !== "",
  );

  // If budget halted AND we have fewer than 2 recommendations, there's not
  // enough material to claim consensus either way.
  if (budgetHalted && withRec.length < 2) return "insufficient-evidence";

  if (withRec.length === 0) return "insufficient-evidence";
  if (withRec.length === 1) return "partial-consensus";

  // Consensus detection — normalize recommendations and count agreement.
  const buckets = new Map<string, number>();
  for (const b of withRec) {
    const key = normalize(b.recommendation!);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  const counts = Array.from(buckets.values()).sort((a, b) => b - a);
  const top = counts[0] ?? 0;
  const total = withRec.length;

  if (top === total) return "consensus";
  // Every branch unique → no-consensus (each bucket has count 1).
  if (top === 1) return "no-consensus";
  if (top > total / 2) return "partial-consensus";
  return "no-consensus";
}

/* -------------------------------------------------------------------------- */
/* Confidence scoring                                                         */
/* -------------------------------------------------------------------------- */

function computeConfidence(
  consensusState: DeliberationConsensusState,
  completedCount: number,
  totalCount: number,
  avgBranchConfidence: number,
): number {
  if (totalCount === 0) return 0;
  const completionRatio = completedCount / totalCount;
  const base =
    consensusState === "consensus"
      ? 0.9
      : consensusState === "partial-consensus"
        ? 0.6
        : consensusState === "no-consensus"
          ? 0.3
          : 0.15;
  const blended = 0.6 * base + 0.4 * avgBranchConfidence;
  return +(blended * completionRatio).toFixed(3);
}

/* -------------------------------------------------------------------------- */
/* Main synthesis                                                             */
/* -------------------------------------------------------------------------- */

export async function synthesizeDeliberation(
  input: SynthesizeDeliberationInput,
): Promise<SynthesizeResult> {
  const { deliberationRunId, branches, budgetHalted = false, degradedDiversity = false } =
    input;

  const roster: BranchRosterEntry[] = branches.map((b) => ({
    branchNodeId: b.branchNodeId,
    role: b.role,
    completed: b.completed,
    ...(b.failureReason ? { failureReason: b.failureReason } : {}),
  }));

  const consensusState = detectConsensusState(branches, budgetHalted);

  // Aggregate claims and persist ClaimRecord rows.
  const claimRecordIds: string[] = [];
  const assertionsRefs: Array<{ claimId: string }> = [];
  const objectionsRefs: Array<{ claimId: string }> = [];
  const rebuttalsRefs: Array<{ claimId: string }> = [];

  const unresolvedRisks: string[] = [];
  const gradesForBadge: Array<{ grade: ClaimEvidenceGrade }> = [];
  const confidences: number[] = [];

  for (const b of branches) {
    if (!b.completed) continue;

    await persistBranchClaims(
      deliberationRunId,
      b,
      "assertion",
      b.assertions ?? [],
      assertionsRefs,
      claimRecordIds,
      gradesForBadge,
      confidences,
    );
    await persistBranchClaims(
      deliberationRunId,
      b,
      "objection",
      b.objections ?? [],
      objectionsRefs,
      claimRecordIds,
      gradesForBadge,
      confidences,
    );
    await persistBranchClaims(
      deliberationRunId,
      b,
      "rebuttal",
      b.rebuttals ?? [],
      rebuttalsRefs,
      claimRecordIds,
      gradesForBadge,
      confidences,
    );

    // Unresolved risks surface from objections without a paired rebuttal.
    for (const obj of b.objections ?? []) {
      unresolvedRisks.push(obj.claimText);
    }
  }

  const completedCount = branches.filter((b) => b.completed).length;
  const avgConf =
    confidences.length > 0
      ? confidences.reduce((s, c) => s + c, 0) / confidences.length
      : 0.5;

  const confidence = computeConfidence(
    consensusState,
    completedCount,
    branches.length,
    avgConf,
  );

  // Merged recommendation: pick the most frequent completed recommendation,
  // fall back to a compact "no consensus" description when none.
  const mergedRecommendation = pickMergedRecommendation(branches, consensusState);
  const rationaleSummary = buildRationaleSummary(
    branches,
    consensusState,
    budgetHalted,
  );

  const outcome: SynthesizedOutcome = {
    deliberationRunId,
    mergedRecommendation,
    rationaleSummary,
    confidence,
    unresolvedRisks,
    consensusState,
    branchCompletionRoster: roster,
    metadata: {
      budgetHalted,
      degradedDiversity,
    },
  };

  const issueSet: SynthesizedIssueSet = {
    deliberationRunId,
    assertions: assertionsRefs,
    objections: objectionsRefs,
    rebuttals: rebuttalsRefs,
    adjudicationNotes: buildAdjudicationNotes(branches, consensusState),
  };

  // Persist DeliberationOutcome + DeliberationIssueSet.
  await prisma.deliberationOutcome.create({
    data: {
      deliberationRunId,
      mergedRecommendation,
      rationaleSummary,
      confidence,
      consensusState,
      evidenceQuality: computeEvidenceBadge(gradesForBadge),
      unresolvedRisks,
      diversityLabel: input.diversityLabel ?? null,
      branchRoster: JSON.parse(JSON.stringify(roster)),
    },
  });

  await prisma.deliberationIssueSet.create({
    data: {
      deliberationRunId,
      assertions: JSON.parse(JSON.stringify(assertionsRefs)),
      objections: JSON.parse(JSON.stringify(objectionsRefs)),
      rebuttals: JSON.parse(JSON.stringify(rebuttalsRefs)),
      adjudicationNotes: issueSet.adjudicationNotes,
    },
  });

  // Update DeliberationRun.consensusState snapshot + completion timestamp.
  await prisma.deliberationRun.update({
    where: { id: deliberationRunId },
    data: {
      consensusState,
      completedAt: new Date(),
    },
  });

  const compactSummary: CompactBuildDeliberationSummary = {
    deliberationRunId,
    consensusState,
    confidence,
    unresolvedCount: unresolvedRisks.length,
    branchesCompleted: completedCount,
    branchesTotal: branches.length,
    budgetHalted,
    degradedDiversity,
    evidenceBadge: computeEvidenceBadge(gradesForBadge),
  };

  return {
    outcome,
    issueSet,
    claimRecordIds,
    compactSummary,
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

async function persistBranchClaims(
  deliberationRunId: string,
  branch: BranchArtifact,
  claimType: ClaimType,
  claims: BranchClaim[],
  refs: Array<{ claimId: string }>,
  allIds: string[],
  gradesForBadge: Array<{ grade: ClaimEvidenceGrade }>,
  confidenceAcc: number[],
): Promise<void> {
  for (const c of claims) {
    const created = await prisma.claimRecord.create({
      data: {
        deliberationRunId,
        branchNodeId: branch.branchNodeId,
        claimText: c.claimText,
        claimType,
        status: "unresolved",
        evidenceGrade: c.evidenceGrade,
        confidence: c.confidence ?? null,
        supportingSourceIds: c.supportingSourceIds ?? [],
        opposingSourceIds: c.opposingSourceIds ?? [],
      },
      select: { id: true },
    });
    refs.push({ claimId: created.id });
    allIds.push(created.id);
    gradesForBadge.push({ grade: c.evidenceGrade });
    if (typeof c.confidence === "number") {
      confidenceAcc.push(c.confidence);
    }
  }
}

function pickMergedRecommendation(
  branches: BranchArtifact[],
  consensusState: DeliberationConsensusState,
): string {
  const withRec = branches
    .filter((b) => b.completed && b.recommendation && b.recommendation.trim() !== "")
    .map((b) => b.recommendation!.trim());

  if (withRec.length === 0) {
    if (consensusState === "insufficient-evidence") {
      return "Insufficient evidence to produce a recommendation.";
    }
    return "No branch produced an explicit recommendation.";
  }

  // Tally and pick the most common normalized recommendation; preserve
  // the first un-normalized instance as the human-facing text.
  const buckets = new Map<string, { count: number; original: string }>();
  for (const r of withRec) {
    const key = normalize(r);
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      buckets.set(key, { count: 1, original: r });
    }
  }
  const top = Array.from(buckets.values()).sort((a, b) => b.count - a.count)[0]!;
  return top.original;
}

function buildRationaleSummary(
  branches: BranchArtifact[],
  consensusState: DeliberationConsensusState,
  budgetHalted: boolean,
): string {
  const completedCount = branches.filter((b) => b.completed).length;
  const total = branches.length;
  const lead =
    consensusState === "consensus"
      ? "All surviving branches agreed on a recommendation."
      : consensusState === "partial-consensus"
        ? "A majority of surviving branches agreed; dissent remains."
        : consensusState === "no-consensus"
          ? "Surviving branches reached materially different recommendations."
          : "Insufficient branch output to support a rationale.";
  const scale = `${completedCount} of ${total} branches completed.`;
  const halt = budgetHalted ? " Run halted due to budget cap." : "";
  return `${lead} ${scale}${halt}`;
}

function buildAdjudicationNotes(
  branches: BranchArtifact[],
  consensusState: DeliberationConsensusState,
): string {
  const failing = branches.filter((b) => !b.completed);
  if (failing.length === 0) return `All branches completed. Consensus state: ${consensusState}.`;
  const notes = failing.map(
    (b) =>
      `Branch ${b.branchNodeId} (role=${b.role}) did not complete${b.failureReason ? `: ${b.failureReason}` : ""}.`,
  );
  return `${notes.join(" ")} Consensus state: ${consensusState}.`;
}
