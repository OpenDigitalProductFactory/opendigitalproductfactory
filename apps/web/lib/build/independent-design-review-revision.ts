// apps/web/lib/build/independent-design-review-revision.ts
//
// BI-3E57890E — revise a plan-phase design that the independent reviewer failed.
//
// Build Studio's own design review (FeatureBuild.designReview) can pass while
// the independent reviewers (AGT-WS-REVIEW for design-spec and spec-approval,
// AGT-WS-EA for architecture-review) fail the same design. The build is then in
// plan, and plan→build is refused with REVIEW_FAILED on every resume tick. The
// design-fix loop only ran for a failing OWN review, so nothing ever fed the
// reviewer's findings back into the design. Live 2026-10-21: 34 to 42 builds sat
// in plan like this.
//
// WWMD DI-39CA5FC9CA8B: Build Studio revises the design itself. This module
// detects the failure, hands the reviewer's findings to the existing
// dispatchDesignReviewFixLoop (its rounds, its regeneration, its own re-review),
// then regenerates the plan, because the plan was written against the old
// design. The independent re-review needs no new trigger: the new accepted
// designDoc revision changes the reviewer route's request key, and the
// owed-review sweep (server-reviewer-dispatch.ts) re-routes REVIEW_FAILED
// against it (BI-D9DECD1B).
//
// Bounded: DESIGN_FIX_MAX_ROUNDS revisions per build, counted from this
// module's own activity trail. After that the build goes to its owner through
// escalateBuildToHuman, naming the unresolved findings.
//
// The finding text is not in the receipt: the payload carries the reviewer's
// reason and stable finding ids. The text is in the reviewer's tool call. It is
// used only when it hashes to the receipt's own finding ids (the derivation in
// receipt-schema.ts); otherwise the reason is the finding.

import { prisma } from "@dpf/db";

import {
  buildStableInitiativeFindingId,
  type InitiativeGateKey,
} from "@/lib/backlog/initiative-readiness/receipt-schema";

export const INDEPENDENT_DESIGN_GATES = ["design-spec", "spec-approval", "architecture-review"] as const;
type IndependentDesignGate = (typeof INDEPENDENT_DESIGN_GATES)[number];

export const INDEPENDENT_REVISION_TOOL = "independent_design_revision";
/** The line written once a revision produced a new design. Counted as a round. */
export const INDEPENDENT_REVISION_DONE_PREFIX = "Revised the design from the independent review";

/** The tools a reviewer records these gates with. */
const REVIEWER_TOOLS = ["record_initiative_design_review", "record_initiative_architecture_review"];
/** How far from the receipt to look for the reviewer's call that wrote it. */
const REVIEWER_CALL_WINDOW_MS = 10 * 60 * 1000;

export type FailingIndependentReceipt = {
  receiptId: string;
  gate: IndependentDesignGate;
  reviewerAgentId: string | null;
  reason: string;
  findingRefs: string[];
  artifactDigest: string | null;
  recordedAt: Date;
};

export type ReviewIssue = { severity: string; description: string };

type ReceiptRow = { id: string; gateKey: string | null; recordedAt: Date; payload: unknown };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asGate(gateKey: string | null): IndependentDesignGate | null {
  const gate = gateKey?.replaceAll("_", "-") ?? null;
  return (INDEPENDENT_DESIGN_GATES as readonly string[]).includes(gate ?? "") ? (gate as IndependentDesignGate) : null;
}

/**
 * The newest receipt per independent design gate, kept only when it FAILS the
 * build's current accepted design revision. A failure that judged an earlier
 * revision is already answered: the revision is waiting for its re-review.
 * Pure; unit-tested.
 */
export function selectFailingIndependentDesignReceipts(
  rows: readonly ReceiptRow[],
  currentRevisionId: string | null,
): FailingIndependentReceipt[] {
  if (!currentRevisionId) return [];
  const newest = [...rows].sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime() || b.id.localeCompare(a.id));
  const seen = new Set<IndependentDesignGate>();
  const failing: FailingIndependentReceipt[] = [];
  for (const row of newest) {
    const gate = asGate(row.gateKey);
    if (!gate || seen.has(gate)) continue;
    seen.add(gate);
    const payload = record(row.payload);
    const artifact = record(payload?.artifactRef);
    if (payload?.decision !== "fail") continue;
    if (artifact?.kind !== "feature-build-revision" || artifact.revisionId !== currentRevisionId) continue;
    failing.push({
      receiptId: row.id,
      gate,
      reviewerAgentId: typeof payload.reviewerAgentId === "string" ? payload.reviewerAgentId : null,
      reason: typeof payload.reason === "string" ? payload.reason.trim() : "",
      findingRefs: Array.isArray(payload.findingRefs) ? payload.findingRefs.filter((ref): ref is string => typeof ref === "string") : [],
      artifactDigest: typeof payload.artifactDigest === "string" ? payload.artifactDigest : null,
      recordedAt: row.recordedAt,
    });
  }
  return failing;
}

/**
 * The receipt's findings as review issues. A reviewer call's finding counts only
 * when its stable id is one the receipt names. With none verified, the
 * reviewer's reason stands in. Pure; unit-tested.
 */
export function matchReceiptFindingIssues(
  receipt: FailingIndependentReceipt,
  reviewerCalls: ReadonlyArray<{ parameters: unknown }>,
): ReviewIssue[] {
  const wanted = new Set(receipt.findingRefs);
  const issues: ReviewIssue[] = [];
  if (receipt.artifactDigest && wanted.size > 0) {
    for (const call of reviewerCalls) {
      const findings = record(call.parameters)?.findings;
      if (!Array.isArray(findings)) continue;
      for (const finding of findings) {
        const entry = record(finding);
        if (typeof entry?.issue !== "string" || !entry.issue.trim()) continue;
        const id = buildStableInitiativeFindingId({
          artifactDigest: receipt.artifactDigest,
          gate: receipt.gate as InitiativeGateKey,
          issue: entry.issue,
        });
        if (!wanted.has(id)) continue;
        wanted.delete(id);
        issues.push({
          severity: entry.severity === "important" ? "important" : "critical",
          description: `[${receipt.gate}] ${entry.issue.trim()}`,
        });
      }
    }
  }
  if (issues.length > 0) return issues;
  return receipt.reason ? [{ severity: "critical", description: `[${receipt.gate}] ${receipt.reason}` }] : [];
}

/** Revisions already spent on this build. Pure; unit-tested. */
export function countIndependentRevisionRounds(rows: ReadonlyArray<{ summary: string | null }>): number {
  return rows.filter((row) => (row.summary ?? "").startsWith(INDEPENDENT_REVISION_DONE_PREFIX)).length;
}

async function loadIssues(receipts: FailingIndependentReceipt[]): Promise<ReviewIssue[]> {
  const issues: ReviewIssue[] = [];
  for (const receipt of receipts) {
    const calls = receipt.findingRefs.length === 0 ? [] : await prisma.toolExecution.findMany({
      where: {
        toolName: { in: REVIEWER_TOOLS },
        createdAt: {
          gte: new Date(receipt.recordedAt.getTime() - REVIEWER_CALL_WINDOW_MS),
          lte: new Date(receipt.recordedAt.getTime() + REVIEWER_CALL_WINDOW_MS),
        },
      },
      select: { parameters: true },
      take: 50,
    }).catch(() => []);
    issues.push(...matchReceiptFindingIssues(receipt, calls));
  }
  return issues;
}

export type IndependentRevisionOutcome =
  | { kind: "resumed"; via: string; detail: string }
  | { kind: "skipped"; reason: string };

/**
 * When the build's current design carries a failing independent design review,
 * revise it through the design-fix loop and regenerate the plan, or hand it to
 * the owner once the revision rounds are spent. Null when nothing is failing,
 * or when the receipts cannot be read, so the caller carries on with the
 * normal plan resume. Never throws.
 */
export async function reviseDesignFromIndependentReview(args: {
  buildId: string;
  userId: string;
  originatingBacklogItemId: string | null;
}): Promise<IndependentRevisionOutcome | null> {
  const { buildId, userId, originatingBacklogItemId } = args;
  if (!originatingBacklogItemId) return null;
  const log = (summary: string) => prisma.buildActivity
    .create({ data: { buildId, tool: INDEPENDENT_REVISION_TOOL, summary: summary.slice(0, 480) } })
    .then(() => undefined)
    .catch(() => undefined);
  try {
    const [revision, rows] = await Promise.all([
      prisma.buildArtifactRevision.findFirst({
        where: { buildId, field: "designDoc", status: "accepted" },
        orderBy: { revisionNumber: "desc" },
        select: { id: true },
      }),
      prisma.backlogItemActivity.findMany({
        where: {
          backlogItemId: originatingBacklogItemId,
          kind: "initiative_gate_receipt",
          gateKey: { in: ["design_spec", "spec_approval", "architecture_review"] },
        },
        select: { id: true, gateKey: true, recordedAt: true, payload: true },
      }),
    ]);
    const failing = selectFailingIndependentDesignReceipts(
      rows.map((row) => ({ ...row, gateKey: row.gateKey == null ? null : String(row.gateKey) })),
      revision?.id ?? null,
    );
    if (failing.length === 0) return null;

    const issues = await loadIssues(failing);
    const gates = failing.map((receipt) => `${receipt.gate} (${receipt.receiptId})`).join(", ");
    const { DESIGN_FIX_MAX_ROUNDS } = await import("@/lib/build/ideate-on-approval");
    const trail = await prisma.buildActivity.findMany({
      where: { buildId, tool: INDEPENDENT_REVISION_TOOL },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { summary: true },
    });
    const spent = countIndependentRevisionRounds(trail);

    if (spent >= DESIGN_FIX_MAX_ROUNDS) {
      const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { id: true, title: true } });
      if (!build) return { kind: "skipped", reason: "build not found" };
      const biTitle = (await prisma.backlogItem
        .findUnique({ where: { id: originatingBacklogItemId }, select: { title: true } })
        .catch(() => null))?.title ?? null;
      await log(`The independent review still fails after ${spent} revision(s): ${gates}. Handing the build to its owner.`);
      const { escalateBuildToHuman, SELF_FIX_CLASS } = await import("@/lib/build/escalate-build-to-human");
      await escalateBuildToHuman({
        buildPk: build.id,
        buildId,
        featureTitle: build.title,
        biTitle,
        originatingBacklogItemId,
        phase: "plan",
        rounds: spent,
        issues,
        selfFixClass: SELF_FIX_CLASS.NEEDS_HUMAN,
        log,
      });
      return { kind: "resumed", via: "escalateBuildToHuman", detail: `independent design review unresolved after ${spent} revision(s): ${gates}` };
    }

    const round = spent + 1;
    await log(`Revising the design from ${failing.length} failing independent review(s): ${gates}; ${issues.length} finding(s) (round ${round}/${DESIGN_FIX_MAX_ROUNDS}).`);
    const { dispatchDesignReviewFixLoop } = await import("@/lib/build/ideate-on-approval");
    const loop = await dispatchDesignReviewFixLoop({ buildId, userId, failedReview: { decision: "fail", issues } });

    if (loop.kind === "repaired") {
      await log(`${INDEPENDENT_REVISION_DONE_PREFIX} (round ${round}/${DESIGN_FIX_MAX_ROUNDS}); regenerating the plan against it. The independent reviewer re-reviews the new revision.`);
      const { dispatchPlanForApprovedBuild } = await import("@/lib/build/plan-on-approval");
      const plan = await dispatchPlanForApprovedBuild({ buildId, userId, forceRegenerate: true });
      return { kind: "resumed", via: "reviseDesignFromIndependentReview", detail: `design revised from ${gates}; plan ${plan.kind}` };
    }
    if (loop.kind === "escalated-after-rounds") {
      // The loop's own review kept failing the regenerated design; it already
      // handed the build to the owner with those issues.
      await log(`${INDEPENDENT_REVISION_DONE_PREFIX} (round ${round}/${DESIGN_FIX_MAX_ROUNDS}), but Build Studio's own review failed it; the fix loop escalated.`);
      return { kind: "resumed", via: "reviseDesignFromIndependentReview", detail: `design fix loop ${loop.kind}` };
    }
    return {
      kind: "skipped",
      reason: `independent design review failed (${gates}); the design fix loop produced no revision (${loop.kind}). The design and plan are kept; retrying next cycle.`,
    };
  } catch (err) {
    // A read failure must not park the build: the normal plan resume carries on.
    console.warn("[independent-design-review-revision] could not evaluate:", { buildId }, err);
    return null;
  }
}
