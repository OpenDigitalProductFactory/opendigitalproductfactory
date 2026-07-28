import type { ProductLineTemplate } from "@dpf/storefront-templates";

export const PRODUCTS_AND_SERVICES_SOLD = {
  slug: "products_and_services_sold",
  label: "Goods and Services for Sale",
} as const;

export interface ProductHierarchyLineInput extends ProductLineTemplate {
  parentKey?: string;
}

export interface ProductHierarchyPlanInput {
  organizationId: string;
  lines: ProductHierarchyLineInput[];
}

export interface PlannedBusinessProduct {
  productId: string;
  key: string;
  name: string;
  description: string | null;
  sortOrder: number;
}

export interface PlannedProductLine {
  lineId: string;
  key: string;
  name: string;
  description: string | null;
  parentLineId: string | null;
  archetypeId: string | null;
  sortOrder: number;
  products: PlannedBusinessProduct[];
}

export interface ProductHierarchyPlan {
  provider: { organizationId: string };
  consumers: [];
  lines: PlannedProductLine[];
}

function assertKey(value: string, field: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error(`${field} must be a lowercase hyphenated key.`);
  }
}

export function validateProductLineGraph(
  lines: ProductHierarchyLineInput[],
): void {
  if (lines.length === 0) {
    throw new Error("At least one product line is required.");
  }
  const byKey = new Map<string, ProductHierarchyLineInput>();
  for (const line of lines) {
    assertKey(line.key, "Product line key");
    if (!line.label.trim()) throw new Error("Product line label is required.");
    if (byKey.has(line.key)) throw new Error("Product line keys must be unique.");
    byKey.set(line.key, line);

    const productKeys = new Set<string>();
    for (const product of line.products) {
      assertKey(product.key, `Product key in "${line.key}"`);
      if (!product.label.trim()) throw new Error("Product label is required.");
      if (productKeys.has(product.key)) {
        throw new Error(`Product keys in line "${line.key}" must be unique.`);
      }
      productKeys.add(product.key);
    }
  }

  for (const line of lines) {
    if (!line.parentKey) continue;
    if (line.parentKey === line.key) {
      throw new Error(`Product line "${line.key}" cannot parent itself.`);
    }
    if (!byKey.has(line.parentKey)) {
      throw new Error(
        `Product line "${line.key}" references an unknown parent.`,
      );
    }
  }

  for (const line of lines) {
    const visited = new Set<string>();
    let current: ProductHierarchyLineInput | undefined = line;
    while (current?.parentKey) {
      if (visited.has(current.key)) {
        throw new Error("Product line hierarchy contains a cycle.");
      }
      visited.add(current.key);
      current = byKey.get(current.parentKey);
    }
  }
}

function safeIdentityPart(value: string, field: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9_-]+/g, "-");
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

export function buildProductHierarchyPlan(
  input: ProductHierarchyPlanInput,
): ProductHierarchyPlan {
  validateProductLineGraph(input.lines);
  const organizationId = safeIdentityPart(
    input.organizationId,
    "Organization ID",
  );
  const lineIdByKey = new Map(
    input.lines.map((line) => [
      line.key,
      `PL-${organizationId}-${line.key}`,
    ]),
  );

  return {
    provider: { organizationId: input.organizationId },
    consumers: [],
    lines: input.lines.map((line, lineIndex) => ({
      lineId: lineIdByKey.get(line.key)!,
      key: line.key,
      name: line.label.trim(),
      description: line.description?.trim() || null,
      parentLineId: line.parentKey
        ? (lineIdByKey.get(line.parentKey) ?? null)
        : null,
      archetypeId: line.archetypeId ?? null,
      sortOrder: lineIndex,
      products: line.products.map((product, productIndex) => ({
        productId: `PR-${organizationId}-${line.key}-${product.key}`,
        key: product.key,
        name: product.label.trim(),
        description: product.description?.trim() || null,
        sortOrder: productIndex,
      })),
    })),
  };
}
