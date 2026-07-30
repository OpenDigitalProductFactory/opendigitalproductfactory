import { prisma } from "@dpf/db";
import {
  PRODUCT_MANAGEMENT_PLAYBOOK_TASK_KIND,
  parseProductManagementPlaybookConfig,
  shouldRefreshProductManagementPlaybook,
  type ProductManagementCanonicalSourceKind,
} from "./product-management-playbook";

type RefreshTaskRow = {
  taskId: string;
  taskConfig: unknown;
  nextRunAt: Date | null;
  updatedAt?: Date;
};

export type ProductManagementPlaybookRefreshDb = {
  scheduledAgentTask: {
    findMany(input: unknown): Promise<RefreshTaskRow[]>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
  scheduledJob: {
    updateMany(input: unknown): Promise<{ count: number }>;
  };
};

export type ProductManagementCanonicalChange = {
  organizationId: string;
  productLineId?: string | null;
  businessProductId?: string | null;
  sourceKind: ProductManagementCanonicalSourceKind;
  sourceId: string;
  changedAt: Date;
};

export type ProductManagementProductChange = Omit<
  ProductManagementCanonicalChange,
  "productLineId" | "businessProductId"
> & { businessProductId: string };

export function createProductManagementChangeCollector(
  refresh: (change: ProductManagementProductChange) => Promise<void> =
    queueProductManagementPlaybookRefreshForProduct,
): {
  collect(change: ProductManagementProductChange): Promise<void>;
  flush(): Promise<void>;
} {
  const changes: ProductManagementProductChange[] = [];
  return {
    async collect(change) {
      changes.push(change);
    },
    async flush() {
      while (changes.length > 0) {
        await refresh(changes[0]);
        changes.shift();
      }
    },
  };
}

function scopeVisibilityWhere(
  change: ProductManagementCanonicalChange,
): Array<Record<string, unknown>> {
  return [
    { productLineId: null, businessProductId: null },
    ...(change.productLineId
      ? [
          {
            productLineId: change.productLineId,
            businessProductId: null,
          },
        ]
      : []),
    ...(change.businessProductId
      ? [{ businessProductId: change.businessProductId }]
      : []),
  ];
}

export async function queueProductManagementPlaybookRefresh(
  change: ProductManagementCanonicalChange,
  db: ProductManagementPlaybookRefreshDb = prisma as unknown as ProductManagementPlaybookRefreshDb,
): Promise<{ inspected: number; queued: number; skipped: number }> {
  const tasks = await db.scheduledAgentTask.findMany({
    where: {
      organizationId: change.organizationId,
      taskKind: PRODUCT_MANAGEMENT_PLAYBOOK_TASK_KIND,
      isActive: true,
      OR: scopeVisibilityWhere(change),
    },
    select: {
      taskId: true,
      taskConfig: true,
      nextRunAt: true,
      updatedAt: true,
    },
  });
  const changeKey = `${change.sourceKind}:${change.sourceId}:${change.changedAt.toISOString()}`;
  let queued = 0;
  let skipped = 0;

  for (const task of tasks) {
    let config;
    try {
      config = parseProductManagementPlaybookConfig(task.taskConfig);
    } catch {
      skipped += 1;
      continue;
    }
    const verdict = shouldRefreshProductManagementPlaybook({
      recipeId: config.recipeId,
      changedSourceKind: change.sourceKind,
      nextFingerprint: changeKey,
      lastSuccessfulFingerprint: config.lastSuccessfulFingerprint,
      lastRefreshQueuedAt: config.lastRefreshQueuedAt
        ? new Date(config.lastRefreshQueuedAt)
        : null,
      lastRefreshChangeKey: config.lastRefreshChangeKey,
      changeKey,
      minimumRefreshMinutes: config.minimumRefreshMinutes,
      now: change.changedAt,
    });
    if (!verdict.shouldRefresh) {
      skipped += 1;
      continue;
    }

    const nextConfig = {
      ...config,
      lastRefreshQueuedAt: change.changedAt.toISOString(),
      lastRefreshChangeKey: changeKey,
    };
    const update = await db.scheduledAgentTask.updateMany({
      where: {
        taskId: task.taskId,
        ...(task.updatedAt ? { updatedAt: task.updatedAt } : {}),
      },
      data: {
        nextRunAt: change.changedAt,
        taskConfig: nextConfig,
      },
    });
    if (update.count === 0) {
      skipped += 1;
      continue;
    }
    queued += 1;
    await db.scheduledJob
      .updateMany({
        where: { jobId: task.taskId },
        data: { nextRunAt: change.changedAt },
      })
      .catch(() => ({ count: 0 }));
  }

  return {
    inspected: tasks.length,
    queued,
    skipped,
  };
}

export async function queueProductManagementPlaybookRefreshBestEffort(
  change: ProductManagementCanonicalChange,
): Promise<void> {
  const compatibilityDb = prisma as unknown as Partial<ProductManagementPlaybookRefreshDb>;
  if (
    typeof compatibilityDb.scheduledAgentTask?.findMany !== "function" ||
    typeof compatibilityDb.scheduledAgentTask?.updateMany !== "function" ||
    typeof compatibilityDb.scheduledJob?.updateMany !== "function"
  ) {
    return;
  }

  await queueProductManagementPlaybookRefresh(
    change,
    compatibilityDb as ProductManagementPlaybookRefreshDb,
  ).catch((error) => {
    console.warn(
      "[product-management-playbook-refresh] Failed to queue refresh for %s:%s: %s",
      change.sourceKind,
      change.sourceId,
      error instanceof Error ? error.message : "unknown error",
    );
  });
}

export async function queueProductManagementPlaybookRefreshForProduct(
  change: ProductManagementProductChange,
): Promise<void> {
  let product: { productLineId: string | null } | null = null;
  try {
    product = await prisma.product.findFirst({
      where: {
        id: change.businessProductId,
        organizationId: change.organizationId,
      },
      select: { productLineId: true },
    });
  } catch {
    // Refresh is a derived, best-effort projection. Older compatibility
    // clients and focused test doubles may not expose the Product delegate;
    // they must never break the canonical sale/booking transaction.
  }
  await queueProductManagementPlaybookRefreshBestEffort({
    ...change,
    productLineId: product?.productLineId ?? null,
  });
}

export async function queueProductManagementPlaybookRefreshForObjective(
  change: {
    organizationId: string;
    objectiveId: string;
    sourceKind: "product-objective" | "product-objective-observation";
    sourceId: string;
    changedAt: Date;
  },
): Promise<void> {
  const objective = await prisma.productObjective
    .findFirst({
      where: {
        organizationId: change.organizationId,
        objectiveId: change.objectiveId,
      },
      select: { productId: true },
    })
    .catch(() => null);
  if (!objective) return;
  await queueProductManagementPlaybookRefreshForProduct({
    organizationId: change.organizationId,
    businessProductId: objective.productId,
    sourceKind: change.sourceKind,
    sourceId: change.sourceId,
    changedAt: change.changedAt,
  });
}

export async function queueProductManagementPlaybookRefreshForBacklogItem(
  change: {
    itemId: string;
    sourceId?: string;
    changedAt: Date;
  },
): Promise<void> {
  const item = await prisma.backlogItem
    .findUnique({
      where: { itemId: change.itemId },
      select: {
        organizationId: true,
        productLineId: true,
        businessProductId: true,
      },
    })
    .catch(() => null);
  if (!item?.organizationId) return;
  await queueProductManagementPlaybookRefreshBestEffort({
    organizationId: item.organizationId,
    productLineId: item.productLineId,
    businessProductId: item.businessProductId,
    sourceKind: "backlog-item",
    sourceId: change.sourceId ?? change.itemId,
    changedAt: change.changedAt,
  });
}
