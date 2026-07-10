import { beforeEach, describe, expect, it, vi } from "vitest";

const documentStore = vi.hoisted(() => ({
  saveManagedDocument: vi.fn(),
  loadManagedDocument: vi.fn(),
  searchManagedDocuments: vi.fn(),
  linkManagedDocuments: vi.fn(),
  listManagedDocumentVersions: vi.fn(),
  changeManagedDocumentState: vi.fn(),
  listManagedDocumentReferences: vi.fn(),
}));
vi.mock("@/lib/documents/document-store", () => documentStore);

const principalLinking = vi.hoisted(() => ({
  ensureAgentPrincipalIdentity: vi.fn(),
  syncUserPrincipal: vi.fn(),
}));
vi.mock("@/lib/identity/principal-linking", () => principalLinking);

import { documentPack } from "./document-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

beforeEach(() => {
  vi.clearAllMocks();
  principalLinking.ensureAgentPrincipalIdentity.mockResolvedValue({ id: "principal-agent" });
  principalLinking.syncUserPrincipal.mockResolvedValue({ id: "principal-user" });
});

const EXPECTED_TOOLS = [
  "doc_save",
  "doc_load",
  "doc_search",
  "doc_link",
  "doc_version_list",
  "doc_state_change",
  "doc_list_references",
];

describe("document pack — registration", () => {
  it("exposes exactly the seven managed-document tools", () => {
    const names = documentPack.definitions.map((d) => d.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());
    for (const name of EXPECTED_TOOLS) {
      expect(documentPack.handlers[name]).toBeTypeOf("function");
    }
  });

  it("mirrors the TOOL_TO_GRANTS gating for every tool", () => {
    expect(documentPack.grants).toEqual({
      doc_save: ["document_write", "registry_write"],
      doc_load: ["document_read", "registry_read"],
      doc_search: ["document_read", "registry_read"],
      doc_link: ["document_write", "registry_write"],
      doc_version_list: ["document_read", "registry_read"],
      doc_state_change: ["document_publish", "registry_write"],
      doc_list_references: ["document_read", "registry_read"],
    });
    // The gating source agrees with the co-located mirror.
    expect(isToolAllowedByGrants("doc_save", ["document_write"])).toBe(true);
    expect(isToolAllowedByGrants("doc_load", ["document_read"])).toBe(true);
    expect(isToolAllowedByGrants("doc_state_change", ["document_publish"])).toBe(true);
    expect(isToolAllowedByGrants("doc_load", ["document_publish"])).toBe(false);
  });

  it("keeps tool descriptions provenance-free (no BI/phase/source-path leakage)", () => {
    for (const def of documentPack.definitions) {
      expect(def.description).not.toMatch(/BI-|Phase \d|apps\/web|EP-/);
    }
  });
});

describe("document pack — handler envelopes", () => {
  it("doc_save attributes the write to the calling agent principal and returns the workspace route", async () => {
    documentStore.saveManagedDocument.mockResolvedValue({
      documentId: "DOC-001",
      version: 2,
      title: "Licensing brief",
    });

    const result = await documentPack.handlers.doc_save!(
      {
        title: "Licensing brief",
        documentKind: "brief",
        contentFormat: "text/markdown",
        contentText: "# Licensing brief",
        tags: ["licensing"],
      },
      "user-1",
      { agentId: "AGT-LICENSING" },
    );

    expect(result.success).toBe(true);
    expect(result.entityId).toBe("DOC-001");
    expect(result.message).toContain("DOC-001");
    expect((result.data as { route?: string }).route).toBe("/workspace/documents/DOC-001");
    expect(documentStore.saveManagedDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Licensing brief",
        actorPrincipalId: "principal-agent",
        createdByPrincipalId: "principal-agent",
      }),
    );
  });

  it("doc_load returns a not-found envelope when the store yields nothing", async () => {
    documentStore.loadManagedDocument.mockResolvedValue(null);
    const result = await documentPack.handlers.doc_load!({ documentId: "DOC-404" }, "user-1");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Document not found.");
  });

  it("doc_search summarizes matches and passes hybrid mode by default", async () => {
    documentStore.searchManagedDocuments.mockResolvedValue([
      { documentId: "DOC-001", currentState: "published", title: "Brief" },
    ]);
    const result = await documentPack.handlers.doc_search!({ query: "brief" }, "user-1");
    expect(result.success).toBe(true);
    expect(result.message).toContain("DOC-001");
    expect(documentStore.searchManagedDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "hybrid", query: "brief" }),
    );
  });

  it("doc_state_change records the transition with the user principal fallback", async () => {
    principalLinking.ensureAgentPrincipalIdentity.mockResolvedValue(null);
    documentStore.changeManagedDocumentState.mockResolvedValue({
      documentId: "DOC-001",
      currentState: "published",
    });

    const result = await documentPack.handlers.doc_state_change!(
      { documentId: "DOC-001", toState: "published", reason: "Approved for library use" },
      "user-1",
      { agentId: "AGT-MISSING" },
    );

    expect(result.success).toBe(true);
    expect(documentStore.changeManagedDocumentState).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "DOC-001",
        toState: "published",
        actorPrincipalId: "principal-user",
      }),
    );
  });

  it("doc_link returns the created reference id", async () => {
    documentStore.linkManagedDocuments.mockResolvedValue({ referenceId: "REF-001" });
    const result = await documentPack.handlers.doc_link!(
      { sourceDocumentId: "DOC-001", targetDocumentId: "DOC-002", refType: "cites" },
      "user-1",
      { agentId: "AGT-1" },
    );
    expect(result.success).toBe(true);
    expect(result.entityId).toBe("REF-001");
  });

  it("doc_version_list and doc_list_references pass the document id through", async () => {
    documentStore.listManagedDocumentVersions.mockResolvedValue([{ version: 1 }, { version: 2 }]);
    documentStore.listManagedDocumentReferences.mockResolvedValue({ inbound: [], outbound: [] });

    const versions = await documentPack.handlers.doc_version_list!({ documentId: "DOC-001" }, "user-1");
    expect(versions.success).toBe(true);
    expect(versions.message).toContain("2 document versions");
    expect(documentStore.listManagedDocumentVersions).toHaveBeenCalledWith("DOC-001");

    const refs = await documentPack.handlers.doc_list_references!({ documentId: "DOC-001" }, "user-1");
    expect(refs.success).toBe(true);
    expect(documentStore.listManagedDocumentReferences).toHaveBeenCalledWith("DOC-001");
  });
});
