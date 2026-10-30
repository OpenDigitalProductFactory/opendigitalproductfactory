"use server";
import { saveWikiOverlayEdit } from "@/lib/actions/wiki-edit";
import { captureCritiqueEntryWithWriter, type CaptureCritiqueEntryInput, type CaptureCritiqueEntryResult } from "@/lib/ux-critique/capture-entry.server";
export type { CaptureCritiqueEntryInput, CaptureCritiqueEntryResult } from "@/lib/ux-critique/capture-entry.server";

export async function captureCritiqueEntry(input: CaptureCritiqueEntryInput): Promise<CaptureCritiqueEntryResult> {
  return captureCritiqueEntryWithWriter(input, saveWikiOverlayEdit);
}
