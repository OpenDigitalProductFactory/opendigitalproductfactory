"use server";

import { requireUser } from "@/lib/actions/shared/guards";
import { saveOverlayEditForAuthenticatedUser } from "@/lib/wiki/save-overlay-edit.server";
export type SaveWikiOverlayEditInput = import("@/lib/wiki/save-overlay-edit.server").SaveWikiOverlayEditInput;
export type SaveWikiOverlayEditResult = import("@/lib/wiki/save-overlay-edit.server").SaveWikiOverlayEditResult;

/** Browser actions derive identity from the session; callers never supply it. */
export async function saveWikiOverlayEdit(input: SaveWikiOverlayEditInput): Promise<SaveWikiOverlayEditResult> {
  try {
    return await saveOverlayEditForAuthenticatedUser(input, (await requireUser()).id);
  } catch (error) {
    return { ok: false, error: (error as Error).message ?? "Unknown error saving page." };
  }
}
