import type { ProductLineTemplate } from "@dpf/storefront-templates";

import {
  buildProductHierarchyPlan,
  type ProductHierarchyLineInput,
} from "./product-hierarchy";

export type ProductHierarchyClient = {
  productLine: {
    upsert: (args: unknown) => Promise<{ id: string; lineId: string }>;
    updateMany: (args: unknown) => Promise<unknown>;
  };
  product: {
    upsert: (args: unknown) => Promise<unknown>;
    updateMany: (args: unknown) => Promise<unknown>;
  };
  storefrontArchetypeComposition: {
    updateMany: (args: unknown) => Promise<unknown>;
  };
};

export interface PersistProductHierarchyInput {
  organizationId: string;
  storefrontId: string;
  lines: ProductHierarchyLineInput[] | ProductLineTemplate[];
  db: ProductHierarchyClient;
}

export interface PersistProductHierarchyResult {
  lineCount: number;
  productCount: number;
}

function orderParentsFirst(
  lines: ProductHierarchyLineInput[],
): ProductHierarchyLineInput[] {
  const byKey = new Map(lines.map((line) => [line.key, line]));
  const depth = (line: ProductHierarchyLineInput): number => {
    let value = 0;
    let current = line;
    const visited = new Set<string>();
    while (current.parentKey) {
      if (visited.has(current.key)) break;
      visited.add(current.key);
      value++;
      current = byKey.get(current.parentKey)!;
    }
    return value;
  };
  return [...lines].sort((a, b) => depth(a) - depth(b));
}

/**
 * Canonical organization product-hierarchy writer. Stable semantic IDs make
 * replay an upsert; only rows previously owned by storefront setup are retired.
 */
export async function persistProductHierarchy(
  input: PersistProductHierarchyInput,
): Promise<PersistProductHierarchyResult> {
  const plan = buildProductHierarchyPlan({
    organizationId: input.organizationId,
    lines: input.lines,
  });
  const plannedByKey = new Map(plan.lines.map((line) => [line.key, line]));
  const databaseIdByKey = new Map<string, string>();
  let productCount = 0;

  for (const lineInput of orderParentsFirst(input.lines)) {
    const line = plannedByKey.get(lineInput.key)!;
    const parentId = lineInput.parentKey
      ? databaseIdByKey.get(lineInput.parentKey)
      : null;
    const saved = await input.db.productLine.upsert({
      where: { lineId: line.lineId },
      update: {
        name: line.name,
        description: line.description,
        parentId,
        sortOrder: line.sortOrder,
        sourceRef: input.storefrontId,
        effectiveTo: null,
      },
      create: {
        lineId: line.lineId,
        organizationId: input.organizationId,
        key: line.key,
        name: line.name,
        description: line.description,
        parentId,
        sortOrder: line.sortOrder,
        sourceKind: "storefront-setup",
        sourceRef: input.storefrontId,
      },
      select: { id: true, lineId: true },
    });
    databaseIdByKey.set(line.key, saved.id);

    for (const product of line.products) {
      await input.db.product.upsert({
        where: { productId: product.productId },
        update: {
          name: product.name,
          description: product.description,
          productLineId: saved.id,
          sortOrder: product.sortOrder,
          sourceRef: input.storefrontId,
          effectiveTo: null,
        },
        create: {
          productId: product.productId,
          organizationId: input.organizationId,
          productLineId: saved.id,
          key: product.key,
          name: product.name,
          description: product.description,
          sortOrder: product.sortOrder,
          sourceKind: "storefront-setup",
          sourceRef: input.storefrontId,
        },
      });
      productCount++;
    }

    await input.db.product.updateMany({
      where: {
        organizationId: input.organizationId,
        productLineId: saved.id,
        sourceKind: "storefront-setup",
        key: { notIn: line.products.map((product) => product.key) },
        effectiveTo: null,
      },
      data: { effectiveTo: new Date() },
    });

    if (line.archetypeId) {
      await input.db.storefrontArchetypeComposition.updateMany({
        where: {
          storefrontId: input.storefrontId,
          archetype: { archetypeId: line.archetypeId },
          removedAt: null,
        },
        data: { productLineId: saved.id },
      });
    }
  }

  await input.db.productLine.updateMany({
    where: {
      organizationId: input.organizationId,
      sourceKind: "storefront-setup",
      key: { notIn: plan.lines.map((line) => line.key) },
      effectiveTo: null,
    },
    data: { effectiveTo: new Date() },
  });

  return { lineCount: plan.lines.length, productCount };
}
