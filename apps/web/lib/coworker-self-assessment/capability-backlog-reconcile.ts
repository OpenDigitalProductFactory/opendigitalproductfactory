// ─── CoworkerCapabilityNeed → Backlog Reconcile (drain orphaned needs) ───────
// EP-INTAKE-UNIFY Phase 6 (BI-8CE36E65).
//
// New capability needs auto-file to the backlog at submission time
// (submitCoworkerSelfAssessment → fileCapabilityNeedToBacklog). But needs
// created before auto-file shipped — and the rare need whose auto-file failed —
// carry no linkedBacklogItemId, so they sit invisibly in the capability-needs
// view. This reconcile files every such orphan through the SAME front door new
// needs use (fileCapabilityNeedToBacklog — identical origin dedup key + body),
// then links it back. Idempotent: it only touches needs with no link, so once
// every need is linked it converges to a zero-write no-op.
//
// Dismissed needs (discarded / duplicate / resolved) are excluded — filing a
// fresh backlog item for already-closed evidence would resurrect dead work.

import { prisma as defaultPrisma } from "@dpf/db";

import {
  fileCapabilityNeedToBacklog,
  linkNeedToBacklogItem,
} from "./assessment-service";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ReconcileCapabilityBacklogResult {
  /** Number of orphaned needs now linked to a backlog item. */
  filed: number;
  /** Semantic backlog item ids created or matched, in need order. */
  itemIds: string[];
}

interface OrphanNeed {
  needId: string;
  agentId: string;
  kind: string;
  severity: string;
  need: string;
  blocks: string;
}

/** Statuses that mean the need is already closed — never re-file these. */
const DISMISSED_STATUSES = ["discarded", "duplicate", "resolved"];

export interface CapabilityReconcileStore {
  coworkerCapabilityNeed: {
    findMany(args: unknown): Promise<OrphanNeed[]>;
  };
}

export interface CapabilityReconcileDeps {
  store?: CapabilityReconcileStore;
  file?: (n: OrphanNeed) => Promise<{ itemId: string } | null>;
  link?: (needId: string, backlogItemId: string) => Promise<unknown>;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * File every orphaned (no linkedBacklogItemId), non-dismissed capability need
 * into the backlog through the shared front door, and link it back. Idempotent
 * and self-healing. Returns how many were filed.
 *
 * Callers on a read path (the capability-needs page server render) should treat
 * failures as non-fatal — the page must still render even if a backfill hiccups.
 */
export async function reconcileCapabilityNeedBacklog(
  deps: CapabilityReconcileDeps = {},
): Promise<ReconcileCapabilityBacklogResult> {
  const store = deps.store ?? (defaultPrisma as unknown as CapabilityReconcileStore);
  const file = deps.file ?? fileCapabilityNeedToBacklog;
  const link = deps.link ?? linkNeedToBacklogItem;

  const orphans = await store.coworkerCapabilityNeed.findMany({
    where: {
      linkedBacklogItemId: null,
      status: { notIn: DISMISSED_STATUSES },
    },
    select: {
      needId: true,
      agentId: true,
      kind: true,
      severity: true,
      need: true,
      blocks: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const itemIds: string[] = [];
  for (const n of orphans) {
    const filed = await file(n);
    if (filed?.itemId) {
      await link(n.needId, filed.itemId);
      itemIds.push(filed.itemId);
    }
  }

  return { filed: itemIds.length, itemIds };
}
