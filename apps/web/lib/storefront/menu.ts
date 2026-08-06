/**
 * Pure projection: the public storefront's active items → a menu grouped by
 * category, for the anonymous walk-up menu view. No I/O — the route supplies
 * the items read via getPublicStorefront. BI-9FEB61B8.
 */
import type { PublicMenuCategory, PublicMenuItem } from "@dpf/types";

/** The item shape getPublicStorefront returns (priceAmount is stringified). */
export interface PublicItemInput {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  priceAmount: string | null;
  priceCurrency: string;
  imageUrl: string | null;
}

function toPrice(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Group active items into menu categories, preserving first-seen category
 * order (items already arrive sorted by sortOrder). Uncategorised items
 * collect under a trailing `category: null` group.
 */
export function groupMenu(items: PublicItemInput[]): PublicMenuCategory[] {
  const order: (string | null)[] = [];
  const byCategory = new Map<string | null, PublicMenuItem[]>();

  for (const item of items) {
    const key = item.category && item.category.trim() !== "" ? item.category : null;
    if (!byCategory.has(key)) {
      byCategory.set(key, []);
      order.push(key);
    }
    byCategory.get(key)!.push({
      id: item.id,
      name: item.name,
      description: item.description,
      category: key,
      price: toPrice(item.priceAmount),
      currency: item.priceCurrency,
      imageUrl: item.imageUrl,
    });
  }

  // Named categories first (first-seen order); the null group always last.
  return order
    .sort((a, b) => (a === null ? 1 : b === null ? -1 : 0))
    .map((category) => ({ category, items: byCategory.get(category)! }));
}
