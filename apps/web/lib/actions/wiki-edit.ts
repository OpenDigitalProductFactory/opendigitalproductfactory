"use server";
// Browser authentication stays at the server-action boundary. An actor-accepting
// writer is internal server code, never a callable client action.
import { requireUser } from "@/lib/actions/shared/guards";
import { saveWikiOverlayEditForActor, type SaveWikiOverlayEditInput, type SaveWikiOverlayEditResult } from "@/lib/wiki/save-overlay.server";
export type { SaveWikiOverlayEditInput, SaveWikiOverlayEditResult } from "@/lib/wiki/save-overlay.server";

export async function saveWikiOverlayEdit(input: SaveWikiOverlayEditInput): Promise<SaveWikiOverlayEditResult> {
  try {
    const user = await requireUser();
    return await saveWikiOverlayEditForActor(input, { userId: user.id });
  } catch (error) {
    return { ok: false, error: (error as Error).message ?? "Unknown error saving page." };
  }
}
