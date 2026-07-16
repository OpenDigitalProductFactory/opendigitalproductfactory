// ─── Improvement → Backlog Reconcile (drain the orphaned improvement queue) ──
// EP-INTAKE-UNIFY Phase 6 (BI-196693D6).
//
// New improvement proposals already auto-file to the backlog at creation time
// (`propose_improvement` → ingestBacklogItem). But proposals created BEFORE
// auto-file shipped — and the rare proposal whose auto-file failed — carry no
// BacklogItem, so they sit invisibly in the Improvements view at status
// "proposed" forever. That is the orphaned parallel queue the operator flagged.
//
// This reconcile files every such orphan through the SAME shared front door new
// proposals use (no second create path), so the backlog becomes the single
// place portal-dev work is tracked. It is idempotent: it only touches proposals
// with no backlogItemId, and sets the link as it goes, so once every proposal is
// linked it converges to a zero-write no-op.
//
// Skill proposals (category="skill") are EXCLUDED — they run the governed
// skill-revision approve/rollback lifecycle (lib/skills/proposals.ts), not the
// backlog. (Spec guardrail: "Skill proposals stay separate.")
//
// Low-severity [reference-doc] proposals (BI-18685188) are also EXCLUDED here,
// mirroring the skill exclusion: the architecture-review scanner emits a large
// recurring batch of low-severity doc-polish suggestions that re-inflate the
// backlog every pass and are founder-reserved canonical-doc authorship. They
// remain as ImprovementProposal rows for founder review — only withheld from the
// backlog. medium/high reference-doc proposals still file. The rule lives in one
// place (isLowSeverityReferenceDocProposal) and is applied at both auto-file
// paths (this reconcile + propose_improvement creation).
//
// See docs/superpowers/specs/2026-06-06-work-intake-unification-design.md §3.3.

import { prisma as defaultPrisma } from "@dpf/db";

import {
  ingestBacklogItem as defaultIngest,
  improvementCategoryToWorkType,
  type BacklogIngestInput,
  type BacklogIngestResult,
} from "@/lib/operate/backlog-ingest";
import { isLowSeverityReferenceDocProposal } from "@/lib/process-spine/reference-doc-promotion";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ReconcileImprovementBacklogResult {
  /** Number of orphaned proposals that are now linked to a backlog item. */
  filed: number;
  /** Semantic backlog item ids created or matched, in proposal order. */
  itemIds: string[];
}

/** The proposal fields the reconcile reads to build a backlog item. */
interface OrphanProposal {
  proposalId: string;
  title: string;
  description: string;
  category: string;
  severity: string;
  observedFriction: string | null;
  submittedById: string;
}

/** Minimal structural view of the store so tests can inject a fake. */
export interface ReconcileStore {
  improvementProposal: {
    findMany(args: unknown): Promise<OrphanProposal[]>;
    update(args: unknown): Promise<unknown>;
  };
}

export interface ReconcileDeps {
  store?: ReconcileStore;
  ingest?: (input: BacklogIngestInput) => Promise<BacklogIngestResult>;
}

// ─── Pure helper ──────────────────────────────────────────────────────────────

/**
 * Compose the backlog item body for an orphaned proposal. Mirrors the body the
 * live `prioritizeImprovement` legacy path builds, so a hand-prioritized item
 * and a reconciled item are indistinguishable (single behaviour, no drift).
 */
export function improvementBacklogBody(p: OrphanProposal): string {
  return [
    p.description,
    p.observedFriction ? `Observed friction: ${p.observedFriction}` : null,
    `Category: ${p.category} | Severity: ${p.severity}`,
    `From improvement proposal ${p.proposalId}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * File every orphaned (no backlogItemId), non-rejected, non-skill improvement
 * proposal into the backlog through the shared front door, and set its
 * backlogItemId. Idempotent and self-healing. Returns how many were filed.
 *
 * Callers that run this on a read path (e.g. the Improvements page server
 * render) should treat failures as non-fatal — the page must still render even
 * if a backfill write hiccups.
 */
export async function reconcileImprovementBacklog(
  deps: ReconcileDeps = {},
): Promise<ReconcileImprovementBacklogResult> {
  const store = deps.store ?? (defaultPrisma as unknown as ReconcileStore);
  const ingest = deps.ingest ?? defaultIngest;

  const found = await store.improvementProposal.findMany({
    where: {
      backlogItemId: null,
      status: { not: "rejected" },
      category: { not: "skill" },
    },
    select: {
      proposalId: true,
      title: true,
      description: true,
      category: true,
      severity: true,
      observedFriction: true,
      submittedById: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Gate low-severity [reference-doc] doc-polish proposals from the backlog
  // (BI-18685188), mirroring the skill exclusion above. They stay as
  // ImprovementProposal rows (with backlogItemId still null) for founder review.
  const orphans = found.filter((p) => !isLowSeverityReferenceDocProposal(p));

  const itemIds: string[] = [];
  for (const p of orphans) {
    const result = await ingest({
      title: p.title,
      body: improvementBacklogBody(p),
      workType: improvementCategoryToWorkType(p.category),
      source: "automated-detection",
      itemIdPrefix: "IMP",
      submittedById: p.submittedById,
      origin: { kind: "improvement", id: p.proposalId },
    });
    await store.improvementProposal.update({
      where: { proposalId: p.proposalId },
      data: { backlogItemId: result.itemId },
    });
    itemIds.push(result.itemId);
  }

  return { filed: itemIds.length, itemIds };
}
