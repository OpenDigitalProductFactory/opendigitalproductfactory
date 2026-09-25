"use server";

// Diagram import into EA review (BI-4C17BF51, slice S8 of BI-815D40C6).
// Uploading stages proposals only; it needs the same capability as editing the
// model because a reviewer will act on what it stages. Accepting or rejecting a
// candidate is the existing reviewReferenceProposal action.

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { err, type ActionResult } from "@/lib/shared/action-result";
import { importDiagramFile, MAX_DIAGRAM_IMPORT_BYTES, MAX_DIAGRAM_IMPORT_LABEL, type DiagramImportSummary } from "@/lib/ea/diagram-import/import-diagram";

export async function importEaDiagram(formData: FormData): Promise<ActionResult<DiagramImportSummary>> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_ea_model")) {
    return err("You do not have permission to import diagrams.");
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return err("Choose a Visio (.vsd, .vsdx) or Draw (.odg) file.");
  if (file.size > MAX_DIAGRAM_IMPORT_BYTES) return err(`The file is larger than ${MAX_DIAGRAM_IMPORT_LABEL}.`);
  const result = await importDiagramFile({ fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()), userId: user.id ?? null });
  if (result.ok) revalidatePath("/ea/views");
  return result;
}
