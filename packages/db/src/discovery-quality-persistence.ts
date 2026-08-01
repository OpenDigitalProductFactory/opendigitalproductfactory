// discovery-quality-persistence.ts
//
// Persisting one discovery run's quality-issue outcome: raise what is warranted,
// close what is not. Extracted from discovery-sync.ts, which had grown past the
// 800-LOC module ceiling — this is a coherent seam (the whole
// PortfolioQualityIssue write path for a sweep) rather than an arbitrary split.
//
// Three passes, in order:
//
//   1. Upsert the issues this sweep decided are warranted.
//   2. Reconcile-on-CONDITION — close issues whose emission condition this pass
//      proved is no longer true. This is the executable form of the registry's
//      `autoResolveWhen`, which was prose no code path read.
//   3. Reconcile-on-RECOVERY — close stale_entity / stale_relationship rows for
//      subjects observed active again.
//
// 2 and 3 are duals: (3) fires when a missing subject comes back, (2) when a
// present subject stops warranting its issue.

import type { InventoryQualityEvaluation } from "./discovery-attribution";

/** Narrow write surface — the real Prisma transaction client is a superset. */
export interface QualityIssuePersistenceTx {
  portfolioQualityIssue: {
    upsert(args: {
      where: { issueKey: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: { status: string; resolvedAt: Date };
    }): Promise<{ count: number }>;
  };
}

export interface PersistQualityIssuesInput {
  evaluation: InventoryQualityEvaluation;
  /** entityKey -> persisted InventoryEntity id, for FK linkage. */
  entityIdsByEntityKey: Map<string, string>;
  /** entityKey -> taxonomyNodeId for entities in this run. */
  taxonomyNodeIdByEntityKey: Map<string, string | null>;
  /** issueKeys already present before this run — anything else counts as created. */
  existingIssueKeys: ReadonlySet<string>;
  /** Entity keys this sweep confirmed active. */
  currentEntityKeys: Iterable<string>;
  /** Relationship keys this sweep observed. */
  currentRelationshipKeys: readonly string[];
  now: Date;
}

export interface PersistQualityIssuesResult {
  createdIssues: number;
}

export async function persistQualityIssues(
  tx: QualityIssuePersistenceTx,
  input: PersistQualityIssuesInput,
): Promise<PersistQualityIssuesResult> {
  const {
    evaluation,
    entityIdsByEntityKey,
    taxonomyNodeIdByEntityKey,
    existingIssueKeys,
    currentEntityKeys,
    currentRelationshipKeys,
    now,
  } = input;

  let createdIssues = 0;

  for (const issue of evaluation.issues) {
    const inventoryEntityId = issue.inventoryEntityKey
      ? entityIdsByEntityKey.get(issue.inventoryEntityKey)
      : undefined;
    const resolvedTaxonomyNodeId = issue.inventoryEntityKey
      ? taxonomyNodeIdByEntityKey.get(issue.inventoryEntityKey) ?? undefined
      : undefined;

    const fields = {
      issueType: issue.issueType,
      status: issue.status,
      severity: issue.severity,
      summary: issue.summary,
      ...(resolvedTaxonomyNodeId
        ? { taxonomyNode: { connect: { nodeId: resolvedTaxonomyNodeId } } }
        : {}),
      ...(inventoryEntityId ? { inventoryEntity: { connect: { id: inventoryEntityId } } } : {}),
    };

    await tx.portfolioQualityIssue.upsert({
      where: { issueKey: issue.issueKey },
      create: { issueKey: issue.issueKey, ...fields },
      update: fields,
    });

    if (!existingIssueKeys.has(issue.issueKey)) createdIssues += 1;
  }

  // (2) Reconcile-on-condition. `evaluateInventoryQuality` derived these in the
  // same pass, from the same facts, as the negation of its emit branches — so the
  // resolve rule cannot drift from the raise rule. See the `resolvedIssueKeys`
  // docblock in discovery-attribution.ts for why it is computed there.
  if (evaluation.resolvedIssueKeys.length > 0) {
    await tx.portfolioQualityIssue.updateMany({
      where: { status: "open", issueKey: { in: evaluation.resolvedIssueKeys } },
      data: { status: "resolved", resolvedAt: now },
    });
  }

  // (3) Reconcile-on-recovery: a subject observed active in THIS sweep is no
  // longer stale. The stale writer only ever opened rows and never closed
  // recovered ones, so a row that went stale for one sweep and came back stayed
  // open forever (the churn behind 1.5k+ accumulated rows). Keyed by issueKey
  // with the subject key embedded, so it is source-bounded by construction:
  // another source's stale issue has a different key and is never matched.
  const recoveredEntityIssueKeys = [...currentEntityKeys].map(
    (entityKey) => `inventory_entity:${entityKey}:stale`,
  );
  if (recoveredEntityIssueKeys.length > 0) {
    await tx.portfolioQualityIssue.updateMany({
      where: {
        issueType: "stale_entity",
        status: "open",
        issueKey: { in: recoveredEntityIssueKeys },
      },
      data: { status: "resolved", resolvedAt: now },
    });
  }

  const recoveredRelationshipIssueKeys = currentRelationshipKeys.map(
    (relationshipKey) => `inventory_relationship:${relationshipKey}:stale`,
  );
  if (recoveredRelationshipIssueKeys.length > 0) {
    await tx.portfolioQualityIssue.updateMany({
      where: {
        issueType: "stale_relationship",
        status: "open",
        issueKey: { in: recoveredRelationshipIssueKeys },
      },
      data: { status: "resolved", resolvedAt: now },
    });
  }

  return { createdIssues };
}
