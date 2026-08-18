import { afterEach, describe, expect, it, vi } from "vitest";

const documentStore = vi.hoisted(() => ({
  saveManagedDocument: vi.fn(),
  loadManagedDocument: vi.fn(),
  searchManagedDocuments: vi.fn(),
  linkManagedDocuments: vi.fn(),
  listManagedDocumentVersions: vi.fn(),
  changeManagedDocumentState: vi.fn(),
  listManagedDocumentReferences: vi.fn(),
}));

const principalLinking = vi.hoisted(() => ({
  ensureAgentPrincipalIdentity: vi.fn(),
  syncUserPrincipal: vi.fn(),
}));

vi.mock("@/lib/documents/document-store", () => documentStore);
vi.mock("@/lib/identity/principal-linking", () => principalLinking);
vi.mock("@dpf/db", () => ({
  prisma: {},
  DISCOVERY_TRIAGE_AGENT_ID: "DISCOVERY-TRIAGE",
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("document management MCP tools", () => {
  it("registers document tools and grant mappings", async () => {
    const { PLATFORM_TOOLS } = await import("@/lib/mcp-tools");
    const { getToolGrantMapping } = await import("@/lib/tak/agent-grants");
    const toolNames = PLATFORM_TOOLS.map((tool) => tool.name);
    const grantMapping = getToolGrantMapping();

    expect(toolNames).toEqual(expect.arrayContaining([
      "doc_save",
      "doc_load",
      "doc_search",
      "doc_link",
      "doc_version_list",
      "doc_state_change",
      "doc_list_references",
    ]));
    expect(grantMapping.doc_save).toEqual(expect.arrayContaining(["document_write"]));
    expect(grantMapping.doc_load).toEqual(expect.arrayContaining(["document_read"]));
    expect(grantMapping.doc_state_change).toEqual(expect.arrayContaining(["document_publish"]));
  });

  it("doc_save attributes the write to the calling agent principal when available", async () => {
    principalLinking.ensureAgentPrincipalIdentity.mockResolvedValue({ id: "principal-agent" });
    principalLinking.syncUserPrincipal.mockResolvedValue({ id: "principal-user" });
    documentStore.saveManagedDocument.mockResolvedValue({
      documentId: "DOC-001",
      version: 1,
      title: "Licensing brief",
    });

    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool(
      "doc_save",
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
    expect(documentStore.saveManagedDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Licensing brief",
        actorPrincipalId: "principal-agent",
        createdByPrincipalId: "principal-agent",
      }),
    );
  });

  it("doc_state_change records lifecycle transitions with the user principal fallback", async () => {
    principalLinking.ensureAgentPrincipalIdentity.mockResolvedValue(null);
    principalLinking.syncUserPrincipal.mockResolvedValue({ id: "principal-user" });
    documentStore.changeManagedDocumentState.mockResolvedValue({
      documentId: "DOC-001",
      currentState: "published",
    });

    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool(
      "doc_state_change",
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
});
