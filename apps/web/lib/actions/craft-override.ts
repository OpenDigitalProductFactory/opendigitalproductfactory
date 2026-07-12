"use server";
// EP-0AF96937 Phase 4: server action for authoring a WSID craft override.
//
// A business "adjusts WSID" for a role by recording a local practice that
// overrides or extends the platform's professional baseline — stored as a
// draft org-overlay `heuristic` page under the profession's slug namespace.
// Draft by default; it does not affect the role's craft grounding until
// explicitly published. Never mutates the platform-seeded corpus.

import { revalidatePath } from "next/cache";

import { saveWikiOverlayEdit } from "@/lib/actions/wiki-edit";
import {
  validateCraftOverride,
  type CraftOverrideInput,
} from "@/lib/wiki/craft-override";

export type SaveCraftOverrideResult =
  | { ok: true; slug: string; status: string }
  | { ok: false; error: string };

export async function saveCraftOverride(
  input: CraftOverrideInput,
): Promise<SaveCraftOverrideResult> {
  const validated = validateCraftOverride(input);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const result = await saveWikiOverlayEdit({
    slug: validated.slug,
    pageKind: "heuristic",
    title: validated.title,
    body: validated.body,
    status: "draft",
    abstract: validated.summary,
    changeSummary: `Craft override authored for ${validated.professionKey} via the WSID editor`,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  revalidatePath(`/coworker-decisions/craft/${validated.professionKey}`);
  revalidatePath("/coworker-decisions/craft");
  return { ok: true, slug: result.slug, status: result.status };
}
