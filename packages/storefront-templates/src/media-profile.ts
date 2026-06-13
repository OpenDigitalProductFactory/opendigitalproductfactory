// Derived per-archetype image affordances.
//
// "Where do images matter for this business?" is not a hand-authored flag on each
// of the 50+ archetypes — it follows from signals the catalog already carries:
// the section templates, the CTA type, the category, and the operating-model
// axes. This mirrors how `BillingPatternProfile` is derived from `commercialModel`
// rather than per-archetype. Adding a new archetype therefore gets sensible image
// slots for free; a leaf can still override via `ArchetypeDefinition.mediaProfile`.

import type {
  ArchetypeDefinition,
  MediaProfile,
  MediaSlot,
  SectionType,
} from "./types";
import { ALL_ARCHETYPES } from "./archetypes/index";

function hasSection(def: ArchetypeDefinition, type: SectionType): boolean {
  return def.sectionTemplates.some((s) => s.type === type);
}

/** Categories where before/after transformation photos are the core proof asset. */
const BEFORE_AFTER_CATEGORIES = new Set([
  "beauty-personal-care",
  "fitness-recreation",
]);

/** Archetype ids (not whole categories) that lean on before/after imagery. */
const BEFORE_AFTER_ARCHETYPES = new Set([
  "pet-grooming",
  "personal-trainer",
]);

/**
 * Derive the image affordances for one archetype from its existing signals.
 * Pure — no DB, no IO. Ordered most- to least-prominent so a UI can render the
 * slots top-down.
 */
export function deriveMediaProfile(def: ArchetypeDefinition): MediaProfile {
  // An explicit override wins (none today, but the door is open).
  if (def.mediaProfile) return def.mediaProfile;

  const slots: MediaSlot[] = [];
  const category = def.category;
  const itemsAreProducts =
    hasSection(def, "items") &&
    (def.ctaType === "purchase" || category === "food-hospitality");
  const itemsAreRentable =
    def.ctaType === "rental" || category === "asset-rental";

  // 1. Hero — almost every storefront has one and it is the first impression.
  if (hasSection(def, "hero")) {
    slots.push({
      role: "hero",
      owner: "storefront",
      applicability: "recommended",
      multiple: false,
      label: "Storefront hero image",
      reason: "First impression on the public storefront landing.",
    });
  }

  // 2. Product / equipment galleries — the catalog is unusable without them.
  if (itemsAreProducts) {
    slots.push({
      role: "product",
      owner: "item",
      applicability: "required",
      multiple: true,
      label: "Product photos",
      reason:
        category === "food-hospitality"
          ? "Food photography is the primary conversion driver for hospitality."
          : "A purchase catalogue cannot convert without product images.",
    });
  }
  if (itemsAreRentable) {
    slots.push({
      role: "equipment",
      owner: "rentable-unit",
      applicability: "required",
      multiple: true,
      label: "Equipment / unit photos",
      reason:
        "Renters choose by condition and spec — units need a photo gallery and a thumbnail.",
    });
  }

  // 3. Adoptable animals — the highest-stakes image case in the catalog.
  if (hasSection(def, "animals-available")) {
    slots.push({
      role: "animal",
      owner: "animal",
      applicability: "required",
      multiple: true,
      label: "Adoptable animal photos",
      reason: "Adoption does not convert without a clear photo per animal.",
    });
  }

  // 4. Before/after — beauty, grooming, fitness sell on visible transformation.
  if (
    hasSection(def, "gallery") &&
    (BEFORE_AFTER_CATEGORIES.has(category) ||
      BEFORE_AFTER_ARCHETYPES.has(def.archetypeId))
  ) {
    slots.push({
      role: "before-after",
      owner: "section",
      applicability: "recommended",
      multiple: true,
      label: "Before / after gallery",
      reason: "Visible transformation is the strongest proof of work here.",
    });
  }

  // 5. General gallery — portfolio/work/impact showcase.
  if (hasSection(def, "gallery")) {
    slots.push({
      role: "gallery",
      owner: "section",
      applicability: "recommended",
      multiple: true,
      label: "Gallery",
      reason: "Portfolio / work / impact showcase.",
    });
  } else if (category === "nonprofit-community") {
    // Nonprofits without an explicit gallery section still benefit from impact
    // photos in their about/donate story.
    slots.push({
      role: "gallery",
      owner: "section",
      applicability: "recommended",
      multiple: true,
      label: "Impact photos",
      reason: "Impact storytelling drives donor conversion.",
    });
  }

  // 6. Team / provider avatars.
  if (hasSection(def, "team")) {
    slots.push({
      role: "avatar",
      owner: "provider",
      applicability: "recommended",
      multiple: false,
      label: "Team headshots",
      reason: "Faces build trust for staff/instructor-led services.",
    });
  }

  // 7. Logo — universal, lowest-prominence (often captured by brand extraction).
  slots.push({
    role: "logo",
    owner: "organization",
    applicability: "recommended",
    multiple: false,
    label: "Organisation logo",
    reason: "Brand mark across the storefront, portal, and documents.",
  });

  return { slots };
}

const PROFILE_CACHE = new Map<string, MediaProfile>();

/** Media profile for an archetype id, or `undefined` if the id is unknown. */
export function getMediaProfile(archetypeId: string): MediaProfile | undefined {
  const cached = PROFILE_CACHE.get(archetypeId);
  if (cached) return cached;
  const def = ALL_ARCHETYPES.find((a) => a.archetypeId === archetypeId);
  if (!def) return undefined;
  const profile = deriveMediaProfile(def);
  PROFILE_CACHE.set(archetypeId, profile);
  return profile;
}

/** All required slots for an archetype — the ones a setup wizard should enforce. */
export function getRequiredMediaSlots(archetypeId: string): MediaSlot[] {
  return (getMediaProfile(archetypeId)?.slots ?? []).filter(
    (s) => s.applicability === "required",
  );
}
