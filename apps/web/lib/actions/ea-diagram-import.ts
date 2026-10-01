"use server";

// Diagram import into EA review (BI-4C17BF51, slice S8 of BI-815D40C6).
// Uploading stages proposals only; it needs the same capability as editing the
// model because a reviewer will act on what it stages. Accepting or rejecting a
// candidate is the existing reviewReferenceProposal action.

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { importDiagramFile, MAX_DIAGRAM_IMPORT_BYTES, MAX_DIAGRAM_IMPORT_LABEL, type DiagramImportSummary } from "@/lib/ea/diagram-import/import-diagram";
import { loadDiagramImports, type DiagramImportView } from "@/lib/ea/diagram-import/load-imports";

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
  return result;
}

export type SerializedDiagramImport = Omit<DiagramImportView, "importedAt"> & { importedAt: string };

/** The newest imports and their candidates, for the import dialog on an EA view. */
export async function listEaDiagramImports(): Promise<ActionResult<{ canManage: boolean; imports: SerializedDiagramImport[] }>> {
  const session = await auth();
  const user = session?.user;
  const role = user ? { platformRole: user.platformRole, isSuperuser: user.isSuperuser } : null;
  if (!role || !can(role, "view_ea_modeler")) return err("You do not have access to EA views.");
  const imports = await loadDiagramImports();
  return ok({
    canManage: can(role, "manage_ea_model"),
    imports: imports.map((item) => ({ ...item, importedAt: item.importedAt.toISOString() })),
  });
}
