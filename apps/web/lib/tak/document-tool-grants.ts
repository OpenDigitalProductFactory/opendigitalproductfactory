// Managed-document tool grants, extracted from agent-grants.ts and spread into
// TOOL_TO_GRANTS (the BANKING_TOOL_GRANTS pattern) so the gating map stays lean.
// Mirrors document-pack.ts grants; document-pack.test.ts asserts parity.
// create_presentation (BI-543819B1) produces a branded deck from an outline and
// stores it as a managed document, so it is a document write.

export const DOCUMENT_TOOL_GRANTS = {
  doc_save: ["document_write", "registry_write"],
  doc_load: ["document_read", "registry_read"],
  doc_search: ["document_read", "registry_read"],
  doc_link: ["document_write", "registry_write"],
  doc_version_list: ["document_read", "registry_read"],
  doc_state_change: ["document_publish", "registry_write"],
  doc_list_references: ["document_read", "registry_read"],
  create_presentation: ["document_write"],
} satisfies Record<string, string[]>;
