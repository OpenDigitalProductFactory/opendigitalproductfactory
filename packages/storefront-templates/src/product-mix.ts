import type {
  BusinessProductTemplate,
  ItemTemplate,
  ProductLineTemplate,
  ProductMixDefinition,
} from "./types";

// Keep the product-mix module's public contract self-contained for consumers
// and tests that import the parser and its result type from the same boundary.
export type { ProductMixDefinition } from "./types";

const KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function toProductMixKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function requiredString(
  value: unknown,
  field: string,
  options: { key?: boolean } = {},
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Product mix ${field} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (options.key && !KEY_PATTERN.test(normalized)) {
    throw new Error(
      `Product mix ${field} must be a lowercase hyphenated key.`,
    );
  }
  return normalized;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, field);
}

function parseProduct(value: unknown, lineKey: string): BusinessProductTemplate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Product mix product in "${lineKey}" must be an object.`);
  }
  const row = value as Record<string, unknown>;
  const product: BusinessProductTemplate = {
    key: requiredString(row.key, `product key in "${lineKey}"`, { key: true }),
    label: requiredString(row.label, `product label in "${lineKey}"`),
  };
  const description = optionalString(
    row.description,
    `product description in "${lineKey}"`,
  );
  if (description) product.description = description;
  return product;
}

function parseLine(value: unknown, field: string): ProductLineTemplate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Product mix ${field} must be an object.`);
  }
  const row = value as Record<string, unknown>;
  const key = requiredString(row.key, `${field} key`, { key: true });
  const rawProducts = row.products ?? [];
  if (!Array.isArray(rawProducts)) {
    throw new Error(`Product mix products for "${key}" must be an array.`);
  }
  const products = rawProducts.map((product) => parseProduct(product, key));
  if (new Set(products.map((product) => product.key)).size !== products.length) {
    throw new Error(`Product keys in line "${key}" must be unique.`);
  }

  const line: ProductLineTemplate = {
    key,
    label: requiredString(row.label, `${field} label`),
    products,
  };
  const description = optionalString(row.description, `${field} description`);
  const archetypeId = optionalString(row.archetypeId, `${field} archetypeId`);
  if (description) line.description = description;
  if (archetypeId) line.archetypeId = archetypeId;
  return line;
}

/**
 * Validate the JSON shape persisted on StorefrontArchetype. The same parser is
 * shared by checked-in seeds, setup reads, custom archetypes, and tests.
 */
export function parseProductMix(value: unknown): ProductMixDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Product mix must be an object.");
  }
  const row = value as Record<string, unknown>;
  const primary = parseLine(row.primary, "primary line");
  const rawAdjacent = row.adjacent ?? [];
  if (!Array.isArray(rawAdjacent)) {
    throw new Error("Product mix adjacent lines must be an array.");
  }
  const adjacent = rawAdjacent.map((line, index) =>
    parseLine(line, `adjacent line ${index + 1}`),
  );
  const lineKeys = [primary.key, ...adjacent.map((line) => line.key)];
  if (new Set(lineKeys).size !== lineKeys.length) {
    throw new Error("Product line keys must be unique.");
  }
  return { primary, adjacent };
}

export function resolveProductMix(
  archetype: {
    archetypeId: string;
    name: string;
    itemTemplates: ItemTemplate[];
    productMix?: unknown;
  },
): ProductMixDefinition {
  if (archetype.productMix) return parseProductMix(archetype.productMix);

  const key =
    toProductMixKey(archetype.archetypeId) ||
    toProductMixKey(archetype.name) ||
    "primary";
  return {
    primary: {
      key,
      label: archetype.name.trim(),
      archetypeId: archetype.archetypeId,
      products: archetype.itemTemplates.map((item, index) => ({
        key: toProductMixKey(item.name) || `product-${index + 1}`,
        label: item.name.trim(),
        description: item.description.trim(),
      })),
    },
    adjacent: [],
  };
}
