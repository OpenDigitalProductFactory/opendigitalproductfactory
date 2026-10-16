"use server";

import { requireUser } from "@/lib/actions/shared/guards";
import { captureCritiqueForAuthenticatedUser } from "@/lib/ux-critique/capture-entry.server";
export type CaptureCritiqueEntryInput = import("@/lib/ux-critique/capture-entry.server").CaptureCritiqueEntryInput;
export type CaptureCritiqueEntryResult = import("@/lib/ux-critique/capture-entry.server").CaptureCritiqueEntryResult;

/** Browser capture authenticates independently of the governed MCP transport. */
export async function captureCritiqueEntry(input: CaptureCritiqueEntryInput): Promise<CaptureCritiqueEntryResult> {
  try {
    return await captureCritiqueForAuthenticatedUser(input, (await requireUser()).id);
  } catch (error) {
    return { ok: false, error: (error as Error).message ?? "Critique capture failed." };
  }
}
