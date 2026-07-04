// EP-0AF96937 Phase 3: helpers for the WWWD business-stance authoring surface.
//
// The org's WWWD doctrine ("what would WE do") is grounded in its own
// org-overlay WikiPages, retrieved by organization — not the platform kernel.
// So "adjusting WWWD" is authoring org-scoped `stance` overlay pages. This
// module is pure: slug derivation + input validation, unit tested. The write
// itself goes through `saveWikiOverlayEdit` (org overlay, draft by default).

/** WWWD stance overlay pages live under this slug prefix, mirroring the kernel. */
export const BUSINESS_STANCE_SLUG_PREFIX = "stances";

/**
 * Derive a stable, kernel-style slug from a stance title.
 * "How we decide refunds" → "stances/how-we-decide-refunds".
 */
export function buildStanceSlug(title: string): string {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${BUSINESS_STANCE_SLUG_PREFIX}/${base || "untitled"}`;
}

export type BusinessStanceInput = {
  /** The question this stance settles, e.g. "How we decide refunds". */
  title: string;
  /** The plain-language position — how the business decides this. */
  body: string;
  /** Optional one-line summary shown in lists / retrieval previews. */
  summary?: string | null;
};

export type BusinessStanceValidation =
  | { ok: true; slug: string; title: string; body: string; summary: string | null }
  | { ok: false; error: string };

const MIN_BODY_CHARS = 12;

/**
 * Validate + normalize a business-stance draft before it is written as an
 * org-overlay page. Keeps the write action thin and gives the form a typed
 * error instead of a DB constraint throw.
 */
export function validateBusinessStance(
  input: BusinessStanceInput,
): BusinessStanceValidation {
  const title = input.title?.trim() ?? "";
  const body = input.body?.trim() ?? "";
  if (title.length < 3) {
    return { ok: false, error: "Give the stance a short title (at least 3 characters)." };
  }
  if (body.length < MIN_BODY_CHARS) {
    return {
      ok: false,
      error: "Describe how your business decides this in a sentence or two.",
    };
  }
  const summary = input.summary?.trim() || null;
  return { ok: true, slug: buildStanceSlug(title), title, body, summary };
}
