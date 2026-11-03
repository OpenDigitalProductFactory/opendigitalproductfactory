"use server";
import { saveWikiOverlayEdit } from "@/lib/actions/wiki-edit";
import { captureCritiqueEntryWithWriter, type CaptureCritiqueEntryInput as CaptureInput, type CaptureCritiqueEntryResult as CaptureResult } from "@/lib/ux-critique/capture-entry.server";
export type CaptureCritiqueEntryInput = CaptureInput;
export type CaptureCritiqueEntryResult = CaptureResult;

export async function captureCritiqueEntry(input: CaptureCritiqueEntryInput): Promise<CaptureCritiqueEntryResult> {
  return captureCritiqueEntryWithWriter(input, saveWikiOverlayEdit);
}
