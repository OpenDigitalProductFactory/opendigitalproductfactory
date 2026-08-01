// Runtime bridge from the governed catalog-enrichment job into the lifecycle backbone.
// The job remains bounded: partial pages may add or refresh evidence, but only a complete
// evidence window may close memberships or resolve gaps.

import { reconcileBaselinePlateau, type BaselineProjectorClient } from "./baseline-projector";
import { resolveLifecycle, type SupportLifecycleMilestone } from "../lifecycle";
import { generateTechnologyCurrencyGaps } from "./gap-generators/technology-currency";
import { reconcileGaps, type ExistingGap, type GapPlanSummary } from "./gaps";

export type InventoryLifecycleRow = {
  id: string;
  name: string;
  status: string;
  supportStatus: string;
  lastSeenAt: Date;
  lastConfirmedRunId: string | null;
  digitalProductId: string | null;
  catalogIdentity: {
    id: string;
    lifecycleMilestones: SupportLifecycleMilestone[];
  } | null;
};

export type InventoryLifecycleProjectorClient = BaselineProjectorClient & {
  inventoryEntity: {
    count(args: Record<string, unknown>): Promise<number>;
    findMany(args: Record<string, unknown>): Promise<InventoryLifecycleRow[]>;
  };
  lifecycleGap: {
    findMany(args: Record<string, unknown>): Promise<ExistingGap[]>;
    create(args: Record<string, unknown>): Promise<{ id: string }>;
    update(args: Record<string, unknown>): Promise<unknown>;
  };
};

export type InventoryLifecycleProjectionResult = {
  evidenceComplete: boolean;
  scanned: number;
  total: number;
  baseline: Awaited<ReturnType<typeof reconcileBaselinePlateau>>;
  gaps: GapPlanSummary;
};

function evidenceRef(row: InventoryLifecycleRow): string {
  return row.lastConfirmedRunId
    ? `discovery-run:${row.lastConfirmedRunId}`
    : `inventory-last-seen:${row.id}:${row.lastSeenAt.toISOString()}`;
}

export async function projectInventoryLifecycle(
  prisma: InventoryLifecycleProjectorClient,
  options: { limit: number; upstreamEvidenceComplete: boolean; now?: Date },
): Promise<InventoryLifecycleProjectionResult> {
  const now = options.now ?? new Date();
  const where = { mergedIntoId: null, status: { not: "inactive" } };
  const [total, rows] = await Promise.all([
    prisma.inventoryEntity.count({ where }),
    prisma.inventoryEntity.findMany({
      where,
      take: options.limit,
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        status: true,
        supportStatus: true,
        lastSeenAt: true,
        lastConfirmedRunId: true,
        digitalProductId: true,
        catalogIdentity: {
          select: {
            id: true,
            lifecycleMilestones: {
              select: { milestone: true, date: true, confidence: true },
            },
          },
        },
      },
    }),
  ]);

  const scanComplete = rows.length === total;
  const resolvedRows = rows.map((row) => ({
    row,
    stateSnapshot: resolveLifecycle({
      kind: "InventoryEntity",
      status: row.status,
      supportStatus: row.supportStatus,
      supportMilestones: row.catalogIdentity?.lifecycleMilestones ?? [],
      now,
    }),
    evidenceRef: evidenceRef(row),
  }));
  const evidence = resolvedRows.map(({ row, stateSnapshot, evidenceRef: ref }) => ({
    kind: "InventoryEntity" as const,
    id: row.id,
    stateSnapshot,
    evidenceRef: ref,
  }));

  const baseline = await reconcileBaselinePlateau({
    prisma,
    evidence,
    evidenceComplete: scanComplete,
  });

  const generated = generateTechnologyCurrencyGaps(
    resolvedRows.map(({ row, stateSnapshot, evidenceRef: ref }) => ({
      kind: "InventoryEntity" as const,
      id: row.id,
      name: row.name,
      canonical: stateSnapshot,
      digitalProductId: row.digitalProductId,
      baselinePlateauId: baseline.plateauElementId,
      evidenceRef: ref,
    })),
  );
  const existing = await prisma.lifecycleGap.findMany({
    where: {
      dimension: "technology-currency",
      baselinePlateauId: baseline.plateauElementId,
      status: { in: ["open", "scoped"] },
    },
    select: { id: true, gapKey: true, status: true, severity: true, title: true, detail: true },
  });
  const gapPlan = reconcileGaps(generated, existing, {
    dimension: "technology-currency",
    evidenceComplete: scanComplete && options.upstreamEvidenceComplete,
  });

  for (const op of gapPlan.ops) {
    if (op.op === "create") {
      await prisma.lifecycleGap.create({ data: op.input });
    } else if (op.op === "update") {
      await prisma.lifecycleGap.update({
        where: { id: op.id },
        data: { ...op.input, detectedAt: now, resolvedAt: null },
      });
    } else {
      await prisma.lifecycleGap.update({
        where: { id: op.id },
        data: { status: "resolved", resolvedAt: now },
      });
    }
  }

  return {
    evidenceComplete: scanComplete && options.upstreamEvidenceComplete,
    scanned: rows.length,
    total,
    baseline,
    gaps: gapPlan.summary,
  };
}
