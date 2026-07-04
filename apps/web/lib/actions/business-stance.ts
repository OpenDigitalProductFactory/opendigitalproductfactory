"use server";
// EP-0AF96937 Phase 3: server action for authoring a WWWD business stance.
//
// A business "adjusts WWWD" by recording how it decides something. That stance
// is stored as an org-overlay `stance` WikiPage (organizationId set), which is
// exactly the corpus the coworker decision-routing block grounds business
// ("what would WE do") calls in. Draft by default — nothing becomes active
// doctrine until it is explicitly published (safe: authoring never auto-grants
// authority).

import { revalidatePath } from "next/cache";

import { saveWikiOverlayEdit } from "@/lib/actions/wiki-edit";
import {
  validateBusinessStance,
  type BusinessStanceInput,
} from "@/lib/wiki/business-stance";

export type SaveBusinessStanceResult =
  | { ok: true; slug: string; status: string }
  | { ok: false; error: string };

/**
 * Record (or update) a WWWD business stance as a draft org-overlay page.
 * Delegates the write to `saveWikiOverlayEdit`, which enforces the org scope,
 * refuses kernel writes, and appends a revision.
 */
export async function saveBusinessStance(
  input: BusinessStanceInput,
): Promise<SaveBusinessStanceResult> {
  const validated = validateBusinessStance(input);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const result = await saveWikiOverlayEdit({
    slug: validated.slug,
    pageKind: "stance",
    title: validated.title,
    body: validated.body,
    status: "draft",
    abstract: validated.summary,
    changeSummary: "Business stance authored via the WWWD editor",
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  revalidatePath("/wiki/stance");
  revalidatePath("/wiki");
  return { ok: true, slug: result.slug, status: result.status };
}
