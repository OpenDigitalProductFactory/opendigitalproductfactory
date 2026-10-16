"use server";

import { requireUser } from "@/lib/actions/shared/guards";
import { saveOverlayEditForAuthenticatedUser, type SaveWikiOverlayEditInput, type SaveWikiOverlayEditResult } from "@/lib/wiki/save-overlay-edit.server";
export type { SaveWikiOverlayEditInput, SaveWikiOverlayEditResult } from "@/lib/wiki/save-overlay-edit.server";

/** Browser actions derive identity from the session; callers never supply it. */
export async function saveWikiOverlayEdit(input: SaveWikiOverlayEditInput): Promise<SaveWikiOverlayEditResult> {
  try {
    return await saveOverlayEditForAuthenticatedUser(input, (await requireUser()).id);
  } catch (error) {
    return { ok: false, error: (error as Error).message ?? "Unknown error saving page." };
  }
}
