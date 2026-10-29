import { createHash, randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";
import { improvementProposalOutcome } from "@/lib/backlog/intake-outcome";
import { isLowSeverityReferenceDocProposal } from "@/lib/process-spine/reference-doc-promotion";
import { isRolledBackPostgresConflict } from "@/lib/shared/postgres-transaction-conflict";
import type { BacklogIngestDeps } from "@/lib/operate/backlog-ingest";
import type { ToolResult } from "@/lib/mcp-tool-types";
import { backlogOriginMarker } from "@/lib/operate/backlog-origin-reconciliation";
import { ownedRowBodyWhere } from "@/lib/federation/federated-twins";

type Context = { routeContext?: string; threadId?: string; agentId?: string };
export type ImprovementDraftDatabase = {
  $transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, options: {
    isolationLevel: "Serializable"; maxWait: number; timeout: number;
  }): Promise<T>;
};

const selection = {
  proposalId: true, title: true, description: true, category: true,
  severity: true, observedFriction: true, backlogItemId: true, status: true,
} as const;

class StaleDraftContext extends Error {}

async function currentThread(tx: Prisma.TransactionClient, userId: string, context?: Context) {
  if (!context?.threadId) return;
  const thread = await tx.agentThread.findFirst({
    where: { id: context.threadId, userId, cancelledAt: null }, select: { id: true },
  });
  if (!thread) throw new StaleDraftContext("The learning context is no longer available to this user.");
}

async function transaction<T>(db: ImprovementDraftDatabase, key: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async tx => {
        // Same explicit draft scope serializes across processes. No transcript
        // content or caller-supplied authority key is used as a lock identifier.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
        return work(tx);
      }, { isolationLevel: "Serializable", maxWait: 5_000, timeout: 20_000 });
    } catch (error) {
      if (attempt >= 2 || !isRolledBackPostgresConflict(error)) throw error;
    }
  }
}

function index(entityType: "improvement" | "backlog", entityId: string, title: string, content: string) {
  // Optional derived search index. Repeat submissions do not rerun completed
  // indexing; the durable draft/intake rows are the authoritative outcome.
  void import("@/lib/semantic-memory").then(({ storePlatformKnowledge }) =>
    storePlatformKnowledge({ entityType, entityId, title, content }),
  ).catch(() => {});
}

/** Internal recommendation persistence; never applies the recommended change. */
export async function submitImprovementDraft(
  params: Record<string, unknown>, userId: string, context?: Context,
  db: ImprovementDraftDatabase = prisma, ingestDeps: BacklogIngestDeps = {},
): Promise<ToolResult> {
  const draft = {
    title: String(params.title ?? "Untitled improvement").trim(),
    description: String(params.description ?? "").trim(),
    category: String(params.category ?? "missing_feature"),
    severity: String(params.severity ?? "medium"),
    observedFriction: typeof params.observedFriction === "string" ? params.observedFriction.trim() || null : null,
  };
  const scope = {
    submittedById: userId, agentId: context?.agentId ?? "unknown",
    routeContext: context?.routeContext ?? "unknown", threadId: context?.threadId ?? null,
  };
  const key = `improvement-draft:${createHash("sha256").update(JSON.stringify({ ...scope, ...draft })).digest("hex")}`;
  let saved;
  try {
    saved = await transaction(db, key, async tx => {
      await currentThread(tx, userId, context);
      const existing = await tx.improvementProposal.findFirst({
        where: { ...scope, ...draft, status: "proposed" }, select: selection,
        orderBy: { createdAt: "asc" },
      });
      if (existing) return { proposal: existing, reused: true };
      const proposal = await tx.improvementProposal.create({
        data: { ...scope, ...draft, proposalId: `IP-${randomUUID().slice(0, 5).toUpperCase()}`, conversationExcerpt: null },
        select: selection,
      });
      return { proposal, reused: false };
    });
  } catch (error) {
    if (error instanceof StaleDraftContext) return { success: false, error: "learning_context_unavailable", message: error.message };
    // A lost connection/commit acknowledgement is not permission to replay.
    throw error;
  }

  const { proposal, reused } = saved;
  if (!reused) index("improvement", proposal.proposalId, proposal.title, proposal.description);
  const suppressed = isLowSeverityReferenceDocProposal(proposal);
  let backlogItemId = proposal.backlogItemId;
  let projectionPending = false;
  let completedIndexes: Array<{ entityId: string; title: string; content: string }> = [];
  if (!suppressed && !backlogItemId) {
    try {
      const projection = await transaction(db, key, async tx => {
        await currentThread(tx, userId, context);
        // Reload after the lock: another call may have finished intake, or a
        // reviewer may have settled this proposal between the two phases.
        const current = await tx.improvementProposal.findUnique({
          where: { proposalId: proposal.proposalId, ...scope, ...draft, status: "proposed" }, select: selection,
        });
        if (!current) return { backlogItemId: null, pending: false, indexes: [] };
        if (current.backlogItemId) return { backlogItemId: current.backlogItemId, pending: false, indexes: [] };
        // Older writers could commit intake before linking the proposal. Reuse
        // its canonical local origin across terminal states without recurrence
        // counts, another origin event or reopening already completed work.
        const origins = await tx.backlogItem.findMany({
          where: { body: { contains: backlogOriginMarker("improvement", current.proposalId) }, AND: [ownedRowBodyWhere()] },
          select: { itemId: true, submittedById: true, agentId: true }, take: 2,
        });
        if (origins.length) {
          if (origins.length !== 1 || origins[0].submittedById !== userId || origins[0].agentId !== (context?.agentId ?? null)) {
            throw new Error("The learning intake origin needs reconciliation.");
          }
          await tx.improvementProposal.update({ where: { proposalId: current.proposalId }, data: { backlogItemId: origins[0].itemId } });
          return { backlogItemId: origins[0].itemId, pending: false, indexes: [] };
        }
        const indexes: Array<{ entityId: string; title: string; content: string }> = [];
        const { ingestBacklogItem, improvementCategoryToWorkType } = await import("@/lib/operate/backlog-ingest");
        const intake = await ingestBacklogItem({
          title: current.title, outcome: improvementProposalOutcome(current),
          body: [current.description, current.observedFriction ? `Observed friction: ${current.observedFriction}` : null,
            `Category: ${current.category} | Severity: ${current.severity}`, `From improvement proposal ${current.proposalId}`].filter(Boolean).join("\n"),
          workType: improvementCategoryToWorkType(current.category), source: "automated-detection", itemIdPrefix: "IMP",
          submittedById: userId, agentId: context?.agentId ?? null,
          origin: { kind: "improvement", id: current.proposalId },
        }, { ...ingestDeps, store: tx, indexKnowledge: value => { indexes.push(value); } });
        await tx.improvementProposal.update({ where: { proposalId: current.proposalId }, data: { backlogItemId: intake.itemId } });
        return { backlogItemId: intake.itemId, pending: false, indexes };
      });
      backlogItemId = projection.backlogItemId;
      completedIndexes = projection.indexes;
    } catch (error) {
      if (error instanceof StaleDraftContext) return {
        success: false, entityId: proposal.proposalId, error: "learning_context_unavailable", message: error.message,
      };
      // Draft persistence is independent of its recoverable intake projection.
      // A repeat reloads this same proposal before deciding whether intake is owed.
      projectionPending = true;
    }
  }

  for (const entry of completedIndexes) {
    try {
      if (ingestDeps.indexKnowledge) ingestDeps.indexKnowledge(entry);
      else index("backlog", entry.entityId, entry.title, entry.content);
    } catch { /* Optional indexing cannot undo the already committed intake. */ }
  }

  return {
    success: true, entityId: proposal.proposalId,
    data: { proposalId: proposal.proposalId, backlogItemId, reused, projectionPending },
    message: backlogItemId
      ? reused ? "Existing recommendation linked to its backlog work." : "Recommendation saved and linked to its backlog work."
      : suppressed
        ? "Recommendation saved for review in the Improvements view."
        : `Recommendation saved.${projectionPending ? " Its backlog link needs recovery." : ""}`,
  };
}
