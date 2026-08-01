// Gap → backlog scoping (EP-LIFECYCLE / slice 5).
// Spec: docs/superpowers/specs/2026-06-07-unified-lifecycle-backbone-design.md §6, §8.1, §10.1(5).
//
// Turns a LifecycleGap into fundable work by creating (or linking) a BacklogItem at the
// right level — portfolio (cross-product investment) or product (via digitalProductId).
// The gap NEVER owns work status: it stores a soft backlogItemId pointer and flips to
// "scoped"; work status is then read from BacklogItem/Epic/FeatureBuild. Mirrors the
// dependency-injected, idempotent createBacklogItemFromFinding pattern so it is testable
// without a live DB and reuses the canonical backlog shape (never a direct planning write
// from a generator).

import { createHash } from "crypto";
import type { GapDimension, GapScopeLevel } from "./gaps";
import type { BacklogWorkType } from "../explore/backlog";
import type { BacklogIngestInput, BacklogIngestResult } from "../operate/backlog-ingest";

/** Map a gap dimension to the closed BacklogItem.workType axis (AGENTS.md §3). */
export function workTypeForDimension(dimension: GapDimension): BacklogWorkType {
  switch (dimension) {
    case "vulnerability":
    case "operational":
      return "bug"; // security / break-fix
    case "capability":
      return "feature"; // new/uplifted capability
    case "technology-currency":
    case "data-quality":
    case "cost":
    case "regulatory":
      return "chore"; // upgrade / housekeeping / compliance
    default:
      return "chore";
  }
}

export type GapForScoping = {
  id: string;
  status: string;
  backlogItemId: string | null;
  dimension: GapDimension;
  severity: string;
  scopeLevel: GapScopeLevel;
  governedThingKind: string;
  governedThingId: string;
  title: string;
  detail: string | null;
  digitalProductId: string | null;
  evidenceRef: string | null;
};

export type BacklogDraftFromGap = {
  type: GapScopeLevel; // "portfolio" | "product" — matches BacklogItem.type
  workType: BacklogWorkType;
  title: string;
  body: string;
  digitalProductId: string | null;
};

/** Pure mapping from a gap to the canonical BacklogItem shape. */
export function gapToBacklogInput(gap: GapForScoping): BacklogDraftFromGap {
  const body = [
    `Auto-scoped from lifecycle gap (${gap.dimension}, severity ${gap.severity}).`,
    `Governed thing: ${gap.governedThingKind}:${gap.governedThingId}.`,
    gap.detail ? `\n${gap.detail}` : null,
    gap.evidenceRef ? `\nEvidence: ${gap.evidenceRef}` : null,
    `\nGap ${gap.id} tracks the architectural delta; this item tracks the work. Work status is owned by the backlog, not the gap.`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    type: gap.scopeLevel,
    workType: workTypeForDimension(gap.dimension),
    title: `Close gap: ${gap.title}`.slice(0, 180),
    body,
    digitalProductId: gap.scopeLevel === "product" ? gap.digitalProductId : null,
  };
}

export type GapScopingDb = {
  lifecycleGap: {
    findUnique(args: Record<string, unknown>): Promise<GapForScoping | null>;
    update(args: Record<string, unknown>): Promise<unknown>;
  };
};

export type GapBacklogIngest = (input: BacklogIngestInput) => Promise<BacklogIngestResult>;

export type ScopeGapResult = {
  gapId: string;
  backlogItemId: string;
  backlogItemRecordId: string | null;
  alreadyLinked: boolean;
};

export function backlogItemIdForGap(gapId: string): string {
  const suffix = createHash("sha256").update(gapId).digest("hex").slice(0, 8).toUpperCase();
  return `BI-LCG-${suffix}`;
}

/**
 * Scope a gap to the backlog. Idempotent: if the gap already carries a backlogItemId it
 * returns that link without creating a duplicate. Otherwise it creates a BacklogItem in the
 * canonical shape, links it back (soft pointer), and flips the gap to "scoped".
 */
export async function scopeGapToBacklog(
  db: GapScopingDb,
  input: { gapId: string; epicId?: string | null; submittedById?: string | null },
  ingest: GapBacklogIngest,
): Promise<ScopeGapResult> {
  const gap = await db.lifecycleGap.findUnique({ where: { id: input.gapId } });
  if (!gap) throw new Error(`LifecycleGap not found: ${input.gapId}`);

  if (gap.backlogItemId) {
    return { gapId: gap.id, backlogItemId: gap.backlogItemId, backlogItemRecordId: null, alreadyLinked: true };
  }

  const draft = gapToBacklogInput(gap);
  const backlogItem = await ingest({
    itemId: backlogItemIdForGap(gap.id),
    type: draft.type,
    workType: draft.workType,
    title: draft.title,
    body: draft.body,
    status: "triaging",
    proposedOutcome: "build",
    // Gaps are detected signals, not human requests.
    source: "automated-detection",
    digitalProductId: draft.digitalProductId,
    epicId: input.epicId ?? undefined,
    submittedById: input.submittedById ?? null,
    origin: { kind: "lifecycle-gap", id: gap.id },
  });

  await db.lifecycleGap.update({
    where: { id: gap.id },
    data: { backlogItemId: backlogItem.itemId, status: "scoped" },
  });

  return {
    gapId: gap.id,
    backlogItemId: backlogItem.itemId,
    backlogItemRecordId: backlogItem.id,
    alreadyLinked: !backlogItem.created,
  };
}
