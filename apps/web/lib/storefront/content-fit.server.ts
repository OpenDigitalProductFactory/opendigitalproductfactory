// apps/web/lib/storefront/content-fit.server.ts
//
// BI-CBE9B9B3 — server helpers that feed the pure content-fit classifier.
// Builds the cross-archetype fingerprint from the seeded archetype library and
// runs the classifier for a storefront. Kept out of content-fit.ts so that
// module stays database-free and unit-testable.

import { prisma } from "@dpf/db";
import {
  classifyStorefrontContentFit,
  type ContentFitFingerprint,
  type ContentFitResult,
  type FitItem,
  type FitSection,
} from "./content-fit";
import type { ArchetypeVocabulary } from "./archetype-vocabulary";

/**
 * Build the fingerprint from every archetype's seed item templates, keyed by
 * item-template name → the categories that seed it. This is what lets the
 * classifier tell "Pallet Storage" (a warehousing template) apart from an
 * owner-typed "Set Dinner Menu" (matches no foreign template).
 */
export async function buildContentFitFingerprint(): Promise<ContentFitFingerprint> {
  const archetypes = await prisma.storefrontArchetype.findMany({
    select: { name: true, category: true, itemTemplates: true },
  });

  const itemNameCategories: Record<string, Set<string>> = {};
  const categoryLabels: Record<string, string> = {};

  for (const archetype of archetypes) {
    if (!categoryLabels[archetype.category]) {
      // Prefer a clean category label derived from the slug; archetype.name is a
      // leaf brand ("3PL Contract Warehousing"), too specific for a group label.
      categoryLabels[archetype.category] = archetype.category
        .split(/[-_]/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }
    const templates = Array.isArray(archetype.itemTemplates)
      ? (archetype.itemTemplates as Array<{ name?: unknown }>)
      : [];
    for (const template of templates) {
      if (typeof template?.name !== "string") continue;
      const key = template.name.trim().toLowerCase();
      if (!key) continue;
      (itemNameCategories[key] ??= new Set()).add(archetype.category);
    }
  }

  return {
    itemNameCategories: Object.fromEntries(
      Object.entries(itemNameCategories).map(([k, v]) => [k, [...v]]),
    ),
    categoryLabels,
  };
}

/**
 * Classify a storefront's live items and sections for cross-archetype /
 * duplicate residue. Loads the storefront's own content plus the fingerprint,
 * then runs the pure classifier.
 */
export async function loadStorefrontContentFit(input: {
  storefrontId: string;
  currentCategory: string;
  vocabulary?: ArchetypeVocabulary;
  items?: FitItem[];
  sections?: FitSection[];
}): Promise<ContentFitResult> {
  const [fingerprint, items, sections] = await Promise.all([
    buildContentFitFingerprint(),
    input.items ??
      prisma.storefrontItem
        .findMany({
          where: { storefrontId: input.storefrontId },
          select: { id: true, name: true, category: true, isActive: true },
        })
        .then((rows) => rows as FitItem[]),
    input.sections ??
      prisma.storefrontSection
        .findMany({
          where: { storefrontId: input.storefrontId },
          select: { id: true, type: true, title: true, isVisible: true, sortOrder: true },
        })
        .then((rows) => rows as FitSection[]),
  ]);

  return classifyStorefrontContentFit({
    currentCategory: input.currentCategory,
    items,
    sections,
    fingerprint,
    ...(input.vocabulary ? { vocabulary: input.vocabulary } : {}),
  });
}
