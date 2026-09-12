// EP-DATA-RETENTION / EP-A33A5C61 slice 4d — retention BEHAVIOUR that a
// table-level declaration cannot express.
//
// The declarations themselves (which models purge, after how many days, on
// which column; which are regulated and retained; which are reference, config,
// domain-managed or projections) live ONCE as `/// @dpf` tags in
// packages/db/prisma/schema and are read back from the Postgres catalog by
// declarations.ts. This file no longer lists a single model window.
//
// What stays here, deliberately:
//   • RETENTION_OVERRIDES — per-model partitions (ToolExecution by auditClass),
//     extra predicates (only READ notifications; only SETTLED edge events; never
//     an in-flight or last-confirming DiscoveryRun) and cascade-correct custom
//     handlers (AgentThread). Each key MUST name a model the schema declares
//     purgeable; retention.test.ts fails otherwise (orphanOverrides).
//   • The executor's structural types.
//
// Floors key on a 3-value bucket derived from the tag's DataCategory list
// (declarations.ts:floorBucket): audit · chat · telemetry.

import { DAYS_30 } from "./constants";

/** Axis the industry floors key on. Derived from DataCategory, never declared. */
export type RetentionFloorBucket = "audit" | "chat" | "telemetry";
export const RETENTION_FLOOR_BUCKETS: readonly RetentionFloorBucket[] = ["audit", "chat", "telemetry"];

/** Minimal structural view of a Prisma model delegate the engine needs. Keeping
 *  it structural (rather than importing PrismaClient) decouples the engine and
 *  makes it trivially testable with an in-memory fake. */
export interface RetentionModelDelegate {
  findMany(args: {
    where: Record<string, unknown>;
    select: { id: true };
    take: number;
  }): Promise<Array<{ id: string }>>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
}

/** Structural Prisma surface the engine + custom handlers rely on. */
export type RetentionPrismaClient = Record<string, RetentionModelDelegate> & {
  $transaction(operations: unknown[]): Promise<unknown[]>;
};

/** Custom purge handler for models whose children RESTRICT a plain delete (e.g.
 *  AgentThread, whose AgentActionProposal children block a naive deleteMany).
 *  Returns rows (or parent records) removed. */
export type RetentionCustomPurge = (args: {
  prisma: RetentionPrismaClient;
  cutoff: Date;
  batchSize: number;
  cap: number;
}) => Promise<{ deleted: number; capped: boolean }>;

export interface PurgePolicy {
  /** Prisma model accessor on PrismaClient, e.g. "toolExecution". */
  model: string;
  /** Human label for reports + the admin surface. */
  label: string;
  category: RetentionFloorBucket;
  /** Timestamp column the cutoff is applied to (varies: createdAt / startedAt /
   *  updatedAt / detectedAt). MUST be a real column with an index — see the
   *  purge-index migration. */
  timestampField: string;
  /** Base retention in days. Industry floors may LENGTHEN this, never shorten. */
  baseRetentionDays: number;
  /** Extra where-clause AND-ed with the cutoff (e.g. only purge READ
   *  notifications). Optional. */
  extraWhere?: Record<string, unknown>;
  /** Custom cascade-correct handler; when present the generic path is bypassed. */
  customPurge?: RetentionCustomPurge;
}

export interface RetainedDataset {
  /** Prisma model accessor. */
  model: string;
  label: string;
  /** Statutory / regulatory basis for retention (cited, not invented). */
  regulatoryBasis: string;
  /** Minimum the business is typically obligated to keep. */
  minRetentionYears: number;
}

// ── Custom handlers ─────────────────────────────────────────────────────────

/**
 * Coworker chat purge. AgentThread has three child relations:
 *   • AgentMessage   — onDelete: Cascade  (DB removes with the thread)
 *   • AgentAttachment — onDelete: Cascade (DB removes with the thread)
 *   • AgentActionProposal — onDelete: RESTRICT on BOTH thread + message FKs
 * so a plain deleteMany on AgentThread throws whenever a thread ever produced a
 * proposal. We therefore delete the proposals for the selected threads first
 * (inside one transaction), then delete the threads — which cascades messages +
 * attachments. Selection is by `updatedAt` (last activity), so an actively-used
 * thread is never swept just because it is old.
 */
export const purgeStaleAgentThreads: RetentionCustomPurge = async ({
  prisma,
  cutoff,
  batchSize,
  cap,
}) => {
  let deleted = 0;
  // eslint-disable-next-line no-constant-condition
  while (deleted < cap) {
    const take = Math.min(batchSize, cap - deleted);
    const threads = await prisma.agentThread.findMany({
      where: { updatedAt: { lt: cutoff } },
      select: { id: true },
      take,
    });
    if (threads.length === 0) break;
    const ids = threads.map((t) => t.id);
    await prisma.$transaction([
      // Remove the RESTRICT-ing children first so the thread delete is legal.
      prisma.agentActionProposal.deleteMany({ where: { threadId: { in: ids } } }),
      // Cascades AgentMessage + AgentAttachment via their onDelete: Cascade FKs.
      prisma.agentThread.deleteMany({ where: { id: { in: ids } } }),
    ]);
    // BI-DG-001: propagate the source deletion to the derived semantic-memory
    // vectors. Best-effort — the nightly reconcile sweep is the safety net for any
    // miss — and never aborts the purge (the source rows are already gone).
    try {
      const { purgeConversationVectorsBySource } = await import(
        "@/lib/inference/semantic-memory-cleanup"
      );
      await purgeConversationVectorsBySource({ threadIds: ids });
    } catch (err) {
      console.warn("[retention] semantic-memory vector cleanup failed:", err);
    }
    deleted += threads.length;
    if (threads.length < take) break;
  }
  return { deleted, capped: deleted >= cap };
};


// ── Behavioural overrides (keyed by Prisma delegate) ────────────────────────

/**
 * ToolExecution audit classes that get the SHORT window. Kept as a literal
 * (not derived from AUDIT_CLASSES) because the ledger branch below is defined
 * as "everything else", and that complement must be reviewable at a glance —
 * retention.test.ts asserts it stays consistent with lib/audit-classes.ts.
 */
export const TOOL_EXECUTION_SHORT_LIVED_AUDIT_CLASSES = ["journal", "metrics_only"] as const;

export type RetentionPartition = {
  label: string;
  extraWhere: Record<string, unknown>;
  /** Window for this partition; omitted = the model's declared window. */
  days?: number;
};

export type RetentionOverride = {
  /** Split the model into disjoint partitions, one policy each. */
  partitions?: readonly RetentionPartition[];
  /** Extra predicate AND-ed with the cutoff (single-policy models). */
  extraWhere?: Record<string, unknown>;
  /** Cascade-correct handler; bypasses the generic id-windowed delete. */
  customPurge?: RetentionCustomPurge;
  /** Override the declared timeAxis (rare; the tag should carry it). */
  timestampField?: string;
};

export const RETENTION_OVERRIDES: Readonly<Record<string, RetentionOverride>> = {
  // ToolExecution is ONE table with THREE audit classes (lib/audit-classes.ts):
  // ledger keeps the declared window (floors lengthen it); journal and
  // metrics_only live 30 days. The ledger branch is the COMPLEMENT of the
  // short-lived classes so a NULL auditClass can never escape every branch.
  toolExecution: {
    partitions: [
      { label: "ledger (and unclassified)", extraWhere: { NOT: { auditClass: { in: TOOL_EXECUTION_SHORT_LIVED_AUDIT_CLASSES } } } },
      { label: "journal", extraWhere: { auditClass: "journal" }, days: DAYS_30 },
      { label: "metrics_only", extraWhere: { auditClass: "metrics_only" }, days: DAYS_30 },
    ],
  },
  // Only purge notifications the user has already read; unread ones are still
  // pending work at any age.
  notification: { extraWhere: { read: true } },
  // Never sweep an alert that is still open; only settled events age out.
  edgeEvent: { extraWhere: { status: { in: ["resolved", "suppressed"] } } },
  // A run still in flight is never eligible; a run that is the LAST confirming
  // run for any inventory entity or relationship is the evidence behind that
  // row's lastSeenAt and stays until a newer run supersedes it.
  discoveryRun: {
    extraWhere: {
      status: { not: "running" },
      confirmedEntities: { none: {} },
      confirmedRelations: { none: {} },
    },
  },
  // Chat threads: proposals RESTRICT the thread delete, so a cascade-ordered
  // handler removes them first; selection is by last activity (updatedAt).
  agentThread: { customPurge: purgeStaleAgentThreads, timestampField: "updatedAt" },
};
