// EP-0AF96937 Phase 4: helpers for the WSID craft-override authoring surface.
//
// WSID ("what should I do") is each role's professional craft, seeded as a
// platform baseline corpus. A business "adjusts WSID" by adding its own local
// override for a profession — e.g. "our data team always partitions by tenant"
// — without mutating the platform seed. Overrides are org-overlay pages under
// a per-profession slug namespace. Pure module: slug + validation, unit tested.

/** WSID override overlay pages live under this per-profession slug namespace. */
export const CRAFT_OVERRIDE_SLUG_PREFIX = "craft";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Derive the override slug for a profession + title:
 * ("data-architect", "Always partition by tenant")
 *   → "craft/data-architect/always-partition-by-tenant".
 */
export function buildCraftOverrideSlug(
  professionKey: string,
  title: string,
): string {
  const prof = slugify(professionKey) || "unscoped";
  const body = slugify(title) || "untitled";
  return `${CRAFT_OVERRIDE_SLUG_PREFIX}/${prof}/${body}`;
}

export type CraftOverrideInput = {
  professionKey: string;
  title: string;
  body: string;
  summary?: string | null;
};

export type CraftOverrideValidation =
  | {
      ok: true;
      slug: string;
      professionKey: string;
      title: string;
      body: string;
      summary: string | null;
    }
  | { ok: false; error: string };

const MIN_BODY_CHARS = 12;

export function validateCraftOverride(
  input: CraftOverrideInput,
): CraftOverrideValidation {
  const professionKey = input.professionKey?.trim() ?? "";
  const title = input.title?.trim() ?? "";
  const body = input.body?.trim() ?? "";
  if (professionKey.length < 2) {
    return { ok: false, error: "A profession is required to scope this override." };
  }
  if (title.length < 3) {
    return { ok: false, error: "Give the override a short title (at least 3 characters)." };
  }
  if (body.length < MIN_BODY_CHARS) {
    return { ok: false, error: "Describe the practice in a sentence or two." };
  }
  return {
    ok: true,
    slug: buildCraftOverrideSlug(professionKey, title),
    professionKey,
    title,
    body,
    summary: input.summary?.trim() || null,
  };
}
