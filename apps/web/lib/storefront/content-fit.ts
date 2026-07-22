// apps/web/lib/storefront/content-fit.ts
//
// BI-CBE9B9B3 — owner-facing content-management recovery for the Restaurant
// (and every other archetype) storefront editors.
//
// The menu/section editors are exactly where a non-technical owner goes to fix
// bad *generated* content — including cross-archetype residue left behind when a
// storefront was seeded from, or migrated between, archetypes (e.g. warehousing
// "Pallet Storage" / "Goods-In & Receiving" items or a banking loan-calculator
// section surfacing inside a Restaurant portal). Nothing marks that residue in
// the schema, so this module classifies it from evidence:
//
//   1. Foreign item — an item whose name exactly matches a *different*
//      archetype-category's seed item template (and is NOT also a template of the
//      current category). Exact-match keeps false-positives near zero: a real
//      "Set Dinner Menu" an owner typed is never a warehousing template name.
//   2. Foreign section — a section whose type is archetype-specific (donate,
//      animals-available, disclosures, calculator) and belongs to a category
//      other than the current one. Universal section types (hero/about/items/
//      contact/team/gallery/testimonials/custom) are NEVER flagged.
//   3. Duplicate section — a second-or-later occurrence of a singleton section
//      type (hero/about/contact/items), the classic generated-duplicate residue.
//
// Everything unknown or owner-authored is left strictly alone. The engine is a
// pure function so it unit-tests without a database.

import type { ArchetypeVocabulary } from "./archetype-vocabulary";

// ─── Section-type vocabulary ────────────────────────────────────────────────

/**
 * Section types that must never appear more than once on a page. A second
 * occurrence is generated duplicate residue.
 */
export const SINGLETON_SECTION_TYPES = ["hero", "about", "contact", "items"] as const;

/**
 * Archetype-specific section types → the archetype category they belong to.
 * A section of one of these types is cross-archetype residue when the storefront
 * is any *other* category. Types absent from this map are universal and are
 * never treated as residue on fit grounds.
 */
export const ARCHETYPE_SPECIFIC_SECTION_TYPES: Record<string, { category: string; label: string }> = {
  donate: { category: "nonprofit-community", label: "Donations" },
  "animals-available": { category: "nonprofit-community", label: "Adoptable animals" },
  disclosures: { category: "banking-financial-services", label: "Regulatory disclosures" },
  calculator: { category: "banking-financial-services", label: "Loan calculator" },
};

/**
 * Human-readable, non-technical names for the built-in section types. The
 * editors show these (or the owner's own section title) instead of the raw slug,
 * so an owner never has to read `hero` / `animals-available`. Archetype
 * vocabulary is applied where it reads better (`items` → "Menu" for a
 * restaurant, `team` → "Staff").
 */
export function friendlySectionTypeLabel(type: string, vocab?: ArchetypeVocabulary): string {
  switch (type) {
    case "hero":
      return "Welcome banner";
    case "about":
      return "About";
    case "items":
      return vocab?.itemsLabel ?? "Items";
    case "contact":
      return "Contact";
    case "team":
      return vocab?.teamLabel ?? "Team";
    case "gallery":
      return "Photos";
    case "testimonials":
      return "Reviews";
    case "donate":
      return "Donations";
    case "animals-available":
      return "Adoptable animals";
    case "disclosures":
      return "Disclosures";
    case "calculator":
      return "Calculator";
    case "custom":
      return "Custom section";
    default:
      // Unknown type — humanise the slug so we still never leak a raw token.
      return type
        .split(/[-_]/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
  }
}

/**
 * Display name for a section row: prefer the owner's own title, otherwise the
 * friendly type label. Never returns a bare slug.
 */
export function sectionDisplayName(
  section: { type: string; title: string | null },
  vocab?: ArchetypeVocabulary,
): string {
  const title = section.title?.trim();
  if (title) return title;
  return friendlySectionTypeLabel(section.type, vocab);
}

// ─── Fit fingerprint ────────────────────────────────────────────────────────

/**
 * The cross-archetype fingerprint the classifier matches against — derived once
 * (server-side) from every archetype's seed templates. Kept separate from the
 * pure classifier so the classifier stays database-free and testable.
 */
export interface ContentFitFingerprint {
  /**
   * Lower-cased seed item-template name → the set of categories that seed an
   * item with that exact name. Used to decide whether an item name is a foreign
   * template (belongs only to other categories) or shared with the current one.
   */
  itemNameCategories: Record<string, string[]>;
  /** Category slug → human label, for describing where residue came from. */
  categoryLabels: Record<string, string>;
}

// ─── Classification ─────────────────────────────────────────────────────────

export interface FitItem {
  id: string;
  name: string;
  category: string | null;
  isActive: boolean;
}

export interface FitSection {
  id: string;
  type: string;
  title: string | null;
  isVisible: boolean;
  sortOrder: number;
}

export type ResidueReason = "foreign-archetype" | "duplicate-section";

export interface ResidueItem {
  id: string;
  name: string;
  reason: "foreign-archetype";
  foreignCategory: string;
  foreignLabel: string;
}

export interface ResidueSection {
  id: string;
  name: string;
  type: string;
  reason: ResidueReason;
  /** For foreign sections, the category the type belongs to. */
  foreignCategory?: string;
  foreignLabel?: string;
}

/**
 * A grouped, previewable recovery unit. Each group gathers residue attributable
 * to one foreign source (a cross-archetype category, or "duplicate sections")
 * so the owner removes it in one deliberate action rather than one row at a time.
 */
export interface ResidueGroup {
  key: string;
  title: string;
  description: string;
  itemIds: string[];
  sectionIds: string[];
  itemNames: string[];
  sectionNames: string[];
  count: number;
}

export interface ContentFitResult {
  residueItems: ResidueItem[];
  residueSections: ResidueSection[];
  groups: ResidueGroup[];
  /** True when any residue was detected — the editors key their banner on this. */
  hasResidue: boolean;
}

function humaniseCategory(category: string, labels: Record<string, string>): string {
  return (
    labels[category] ??
    category
      .split(/[-_]/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

/**
 * Classify a storefront's items and sections against the current archetype,
 * flagging cross-archetype and duplicate residue. Pure — no I/O.
 */
export function classifyStorefrontContentFit(input: {
  currentCategory: string;
  items: FitItem[];
  sections: FitSection[];
  fingerprint: ContentFitFingerprint;
  vocabulary?: ArchetypeVocabulary;
}): ContentFitResult {
  const { currentCategory, items, sections, fingerprint, vocabulary } = input;
  const residueItems: ResidueItem[] = [];
  const residueSections: ResidueSection[] = [];

  // ── Foreign items: exact name match to another category's seed template ──
  for (const item of items) {
    const key = item.name.trim().toLowerCase();
    const categories = fingerprint.itemNameCategories[key];
    if (!categories || categories.length === 0) continue;
    // Shared with the current category → legitimate, never flag.
    if (categories.includes(currentCategory)) continue;
    const foreignCategory = categories[0]!;
    residueItems.push({
      id: item.id,
      name: item.name,
      reason: "foreign-archetype",
      foreignCategory,
      foreignLabel: humaniseCategory(foreignCategory, fingerprint.categoryLabels),
    });
  }

  // ── Foreign sections: archetype-specific type from another category ──
  const seenSingletonTypes = new Set<string>();
  const sortedSections = [...sections].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const section of sortedSections) {
    const name = sectionDisplayName(section, vocabulary);
    const specific = ARCHETYPE_SPECIFIC_SECTION_TYPES[section.type];
    if (specific && specific.category !== currentCategory) {
      residueSections.push({
        id: section.id,
        name,
        type: section.type,
        reason: "foreign-archetype",
        foreignCategory: specific.category,
        foreignLabel: humaniseCategory(specific.category, fingerprint.categoryLabels),
      });
      continue;
    }
    // ── Duplicate singleton sections ──
    if ((SINGLETON_SECTION_TYPES as readonly string[]).includes(section.type)) {
      if (seenSingletonTypes.has(section.type)) {
        residueSections.push({
          id: section.id,
          name,
          type: section.type,
          reason: "duplicate-section",
        });
      } else {
        seenSingletonTypes.add(section.type);
      }
    }
  }

  const groups = buildGroups(residueItems, residueSections, vocabulary);

  return {
    residueItems,
    residueSections,
    groups,
    hasResidue: residueItems.length > 0 || residueSections.length > 0,
  };
}

function buildGroups(
  residueItems: ResidueItem[],
  residueSections: ResidueSection[],
  vocabulary?: ArchetypeVocabulary,
): ResidueGroup[] {
  const byCategory = new Map<
    string,
    { label: string; itemIds: string[]; sectionIds: string[]; itemNames: string[]; sectionNames: string[] }
  >();

  const ensure = (category: string, label: string) => {
    let g = byCategory.get(category);
    if (!g) {
      g = { label, itemIds: [], sectionIds: [], itemNames: [], sectionNames: [] };
      byCategory.set(category, g);
    }
    return g;
  };

  for (const item of residueItems) {
    const g = ensure(item.foreignCategory, item.foreignLabel);
    g.itemIds.push(item.id);
    g.itemNames.push(item.name);
  }
  for (const section of residueSections) {
    if (section.reason !== "foreign-archetype") continue;
    const g = ensure(section.foreignCategory!, section.foreignLabel!);
    g.sectionIds.push(section.id);
    g.sectionNames.push(section.name);
  }

  const groups: ResidueGroup[] = [];
  const itemsWord = (vocabulary?.itemsLabel ?? "items").toLowerCase();
  for (const [category, g] of byCategory) {
    const count = g.itemIds.length + g.sectionIds.length;
    groups.push({
      key: `category:${category}`,
      title: `${g.label} content`,
      description:
        `This ${itemsWord} content looks like it came from a different business type (${g.label}) ` +
        `and doesn't fit your storefront.`,
      itemIds: g.itemIds,
      sectionIds: g.sectionIds,
      itemNames: g.itemNames,
      sectionNames: g.sectionNames,
      count,
    });
  }

  // Duplicate sections form their own group.
  const duplicates = residueSections.filter((s) => s.reason === "duplicate-section");
  if (duplicates.length > 0) {
    groups.push({
      key: "duplicate-sections",
      title: "Duplicate sections",
      description:
        "These sections repeat one that already appears on your page. Removing the duplicates " +
        "leaves the first of each kind in place.",
      itemIds: [],
      sectionIds: duplicates.map((s) => s.id),
      itemNames: [],
      sectionNames: duplicates.map((s) => s.name),
      count: duplicates.length,
    });
  }

  return groups;
}
