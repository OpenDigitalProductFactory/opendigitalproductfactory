// BI-CBE9B9B3 — mobile UX checks for the menu and section editors.
//
// These assert the acceptance invariants against the *default* (390px) rendered
// surface — the state an owner lands on: single labelled action per row, 44px hit
// areas, row-specific (non-repeated) accessible names, no internal slug leakage,
// and a visible recovery surface when residue is present.

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ItemsManager } from "./ItemsManager";
import { ItemFormDialog } from "./ItemFormDialog";
import { SectionsManager } from "./SectionsManager";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";
import type { ResidueGroup } from "@/lib/storefront/content-fit";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/storefront/content-recovery-actions", () => ({
  recoverGeneratedResidue: vi.fn(async () => ({
    success: true, removedItems: 0, removedSections: 0, deactivatedItems: 0, skipped: [],
  })),
}));

const vocab = getVocabulary("food-hospitality");

function openTags(html: string, tag: string): string[] {
  return html.match(new RegExp(`<${tag}[^>]*>`, "g")) ?? [];
}
function ariaLabels(html: string): string[] {
  return [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]!);
}

const items = [
  { id: "i1", itemId: "itm-1", name: "Set Dinner Menu", description: "Three courses", category: "Set Menus", priceAmount: "45", priceCurrency: "USD", priceType: "fixed", ctaType: "purchase", ctaLabel: null, imageUrl: null, isActive: true, sortOrder: 0, bookingConfig: null },
  { id: "i2", itemId: "itm-2", name: "Table for 2", description: null, category: null, priceAmount: null, priceCurrency: "USD", priceType: null, ctaType: "booking", ctaLabel: null, imageUrl: null, isActive: true, sortOrder: 1, bookingConfig: null },
  { id: "i3", itemId: "itm-3", name: "Sunday Roast", description: null, category: null, priceAmount: "20", priceCurrency: "USD", priceType: "fixed", ctaType: "purchase", ctaLabel: null, imageUrl: null, isActive: false, sortOrder: 2, bookingConfig: null },
];

function renderItems(
  residueGroups: ResidueGroup[] = [],
  renderedItems: Array<
    (typeof items)[number] & {
      catalogItemId?: string | null;
      compatibilitySource?: "catalog" | "storefront";
    }
  > = items,
) {
  return renderToStaticMarkup(
    <ItemsManager
      storefrontId="sf1"
      items={renderedItems}
      vocabulary={vocab}
      categorySuggestions={[]}
      defaultCtaType="purchase"
      defaultCurrency="USD"
      isPublished
      residueGroups={residueGroups}
    />,
  );
}

const sections = [
  { id: "s1", type: "hero", title: null, sortOrder: 0, isVisible: true },
  { id: "s2", type: "items", title: null, sortOrder: 1, isVisible: true },
  { id: "s3", type: "animals-available", title: null, sortOrder: 2, isVisible: true },
];

function renderSections(residueGroups: ResidueGroup[] = []) {
  return renderToStaticMarkup(
    <SectionsManager
      storefrontId="sf1"
      sections={sections}
      vocabulary={vocab}
      isPublished
      residueGroups={residueGroups}
    />,
  );
}

describe("menu editor mobile UX", () => {
  it("gives each row exactly one labelled action trigger (low action count)", () => {
    const html = renderItems();
    const managers = ariaLabels(html).filter((l) => l.startsWith("Manage "));
    expect(managers).toHaveLength(items.length);
  });

  it("has no sub-44px interactive controls", () => {
    const html = renderItems();
    for (const button of openTags(html, "button")) {
      expect(button).toContain("min-h-[44px]");
    }
  });

  it("uses row-specific accessible names with no repeated labels", () => {
    const html = renderItems();
    const managers = ariaLabels(html).filter((l) => l.startsWith("Manage "));
    expect(new Set(managers).size).toBe(managers.length);
    expect(managers).toContain("Manage Set Dinner Menu");
  });

  it("drops the old terse repeated controls", () => {
    const html = renderItems();
    expect(html).not.toMatch(/>On<|>Off<|>Del<|>Edit<\s*<\/button>/);
  });

  it("shows the grouped recovery surface only when residue exists", () => {
    expect(renderItems()).not.toContain('data-testid="residue-recovery"');
    const withResidue = renderItems([
      { key: "category:warehousing-fulfilment", title: "Warehousing Fulfilment content", description: "…", itemIds: ["i2"], sectionIds: [], itemNames: ["Pallet Storage"], sectionNames: [], count: 1 },
    ]);
    expect(withResidue).toContain('data-testid="residue-recovery"');
    expect(withResidue).toContain("doesn’t fit your storefront");
  });

  it("keeps the common catalog-backed workflow collapsed and flags only real legacy divergence", () => {
    const linked = renderItems([], [{
      ...items[0]!,
      catalogItemId: "CAT-DINNER",
      compatibilitySource: "catalog" as const,
    }]);
    expect(linked).not.toContain("Needs setup link");
    expect(linked).not.toContain("ProductOffering");
    expect(linked).not.toContain("CatalogItem");

    const legacy = renderItems([], [{
      ...items[0]!,
      catalogItemId: null,
      compatibilitySource: "storefront" as const,
    }]);
    expect(legacy).toContain("Needs setup link");
  });
});

describe("item product-line disclosure", () => {
  const baseProps = {
    open: true,
    onClose: vi.fn(),
    onSave: vi.fn(async () => undefined),
    vocabulary: vocab,
    categorySuggestions: [],
    defaultCtaType: "purchase",
    isEditing: false,
  };

  it("hides product-line modeling for a simple one-line business", () => {
    const html = renderToStaticMarkup(
      <ItemFormDialog
        {...baseProps}
        productLines={[{ id: "line-services", name: "Services" }]}
      />,
    );
    expect(html).not.toContain("Product line");
  });

  it("asks for the real product line only when the business has multiple lines", () => {
    const html = renderToStaticMarkup(
      <ItemFormDialog
        {...baseProps}
        productLines={[
          { id: "line-services", name: "Salon services" },
          { id: "line-retail", name: "Hair-care products" },
        ]}
      />,
    );
    expect(html).toContain("Product line");
    expect(html).toContain("Salon services");
    expect(html).toContain("Hair-care products");
  });
});

describe("section editor mobile UX", () => {
  it("never leaks internal type slugs — shows friendly names", () => {
    const html = renderSections();
    expect(html).not.toMatch(/>hero</);
    expect(html).not.toContain("animals-available");
    expect(html).toContain("Welcome banner");
    expect(html).toContain("Menu"); // items → Restaurant vocab
  });

  it("labels each section action per-row with 44px targets", () => {
    const html = renderSections();
    for (const button of openTags(html, "button")) {
      expect(button).toContain("min-h-[44px]");
    }
    const managers = ariaLabels(html).filter((l) => l.startsWith("Manage "));
    expect(managers).toContain("Manage Welcome banner section");
    expect(new Set(managers).size).toBe(managers.length);
  });
});
