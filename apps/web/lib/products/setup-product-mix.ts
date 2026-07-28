import {
  parseProductMix,
  toProductMixKey,
  type ProductLineTemplate,
  type ProductMixDefinition,
} from "@dpf/storefront-templates";

export interface ProductLineSelection {
  /** A key from the archetype's suggested product mix; null means custom. */
  suggestionKey: string | null;
  label: string;
}

const MAX_SETUP_PRODUCT_LINES = 8;
const MAX_PRODUCT_LINE_LABEL_LENGTH = 80;

export function resolveSetupProductLines(input: {
  productMix: unknown;
  selections: ProductLineSelection[];
}): ProductLineTemplate[] {
  const mix: ProductMixDefinition = parseProductMix(input.productMix);
  if (!Array.isArray(input.selections) || input.selections.length === 0) {
    throw new Error("The primary product line is required.");
  }
  if (input.selections.length > MAX_SETUP_PRODUCT_LINES) {
    throw new Error(
      `Setup supports at most ${MAX_SETUP_PRODUCT_LINES} product lines.`,
    );
  }

  const suggestions = new Map(
    [mix.primary, ...(mix.adjacent ?? [])].map((line) => [line.key, line]),
  );
  const resolved: ProductLineTemplate[] = input.selections.map(
    (selection, index) => {
      if (!selection || typeof selection !== "object") {
        throw new Error(`Product line ${index + 1} is invalid.`);
      }
      const label = selection.label?.trim();
      if (!label) throw new Error(`Product line ${index + 1} label is required.`);
      if (label.length > MAX_PRODUCT_LINE_LABEL_LENGTH) {
        throw new Error(
          `Product line ${index + 1} label must be ${MAX_PRODUCT_LINE_LABEL_LENGTH} characters or fewer.`,
        );
      }

      if (selection.suggestionKey !== null) {
        const suggestion = suggestions.get(selection.suggestionKey);
        if (!suggestion) {
          throw new Error(
            `Unknown product-line suggestion "${selection.suggestionKey}".`,
          );
        }
        return { ...suggestion, label };
      }

      const key = toProductMixKey(label);
      if (!key) throw new Error(`Product line ${index + 1} label is invalid.`);
      return { key, label, products: [] };
    },
  );

  if (!resolved.some((line) => line.key === mix.primary.key)) {
    throw new Error("The primary product line is required.");
  }
  if (new Set(resolved.map((line) => line.key)).size !== resolved.length) {
    throw new Error("Product line names and keys must be unique.");
  }
  return resolved;
}
