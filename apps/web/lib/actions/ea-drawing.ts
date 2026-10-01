"use server";

// EA view drawing export action (BI-4C17BF51, slice S8 of BI-815D40C6).
// The EA view's Export menu calls this; the engine work is lib/ea/view-drawing-export.ts.
// Exporting is read-shaped, so it needs the same capability as viewing the view.

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { EA_DRAWING_FORMATS, exportEaViewDrawingFile, type EaDrawingFormat } from "@/lib/ea/view-drawing-export";

export async function exportEaViewDrawing(input: {
  viewId: string;
  format: EaDrawingFormat;
}): Promise<ActionResult<{ fileName: string; mimeType: string; base64: string }>> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_ea_modeler")) {
    return err("You do not have access to EA views.");
  }
  if (!EA_DRAWING_FORMATS.includes(input.format)) {
    return err(`Unsupported export format: ${String(input.format)}`);
  }
  const result = await exportEaViewDrawingFile({ viewId: input.viewId, format: input.format });
  if (!result.ok) return result;
  const { fileName, mimeType, bytes } = result.data;
  return ok({ fileName, mimeType, base64: bytes.toString("base64") });
}
