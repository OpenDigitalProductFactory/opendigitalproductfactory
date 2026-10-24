// Managed-document tool grants, extracted from agent-grants.ts and spread into
// TOOL_TO_GRANTS (the BANKING_TOOL_GRANTS pattern) so the gating map stays lean.
// Mirrors document-pack.ts grants; document-pack.test.ts asserts parity.
// create_presentation (BI-543819B1) produces a branded deck from an outline and
// stores it as a managed document, so it is a document write.
// The four other render families (BI-012487AA) are the same kind of write.
// create_drawing also honours ea_drawing_export: the EA architect already holds
// it to render-and-store EA view drawings, so it can draw a free diagram
// without being given doc_save and doc_link through document_write.

export const DOCUMENT_TOOL_GRANTS = {
  doc_save: ["document_write", "registry_write"],
  doc_load: ["document_read", "registry_read"],
  doc_search: ["document_read", "registry_read"],
  doc_link: ["document_write", "registry_write"],
  doc_version_list: ["document_read", "registry_read"],
  doc_state_change: ["document_publish", "registry_write"],
  doc_list_references: ["document_read", "registry_read"],
  create_presentation: ["document_write"],
  create_report: ["document_write"],
  create_letter: ["document_write"],
  create_sheet: ["document_write"],
  create_drawing: ["document_write", "ea_drawing_export"],
} satisfies Record<string, string[]>;
