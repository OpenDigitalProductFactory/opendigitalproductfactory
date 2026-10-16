import { beforeEach, describe, expect, it, vi } from "vitest";

const families = vi.hoisted(() => ({
  createReport: vi.fn(),
  createLetter: vi.fn(),
  createSheet: vi.fn(),
  createDrawing: vi.fn(),
}));
vi.mock("@/lib/documents/generation/create-family-documents", () => families);

const principalLinking = vi.hoisted(() => ({
  ensureAgentPrincipalIdentity: vi.fn(),
  syncUserPrincipal: vi.fn(),
}));
vi.mock("@/lib/identity/principal-linking", () => principalLinking);

import { documentPack } from "./document-pack";
import { DOCUMENT_FAMILY_TOOL_GRANTS } from "./document-family-tools";
import { DOCUMENT_TOOL_GRANTS } from "@/lib/tak/document-tool-grants";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

beforeEach(() => {
  vi.clearAllMocks();
  principalLinking.ensureAgentPrincipalIdentity.mockResolvedValue({ id: "principal-finance" });
  principalLinking.syncUserPrincipal.mockResolvedValue({ id: "principal-user" });
});

const TOOLS = [
  { name: "create_report", create: families.createReport, required: ["title", "sections"] },
  { name: "create_letter", create: families.createLetter, required: ["recipient", "paragraphs", "signatureName"] },
  { name: "create_sheet", create: families.createSheet, required: ["title"] },
  { name: "create_drawing", create: families.createDrawing, required: ["title"] },
] as const;

function created(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: {
      documentId: "DOC-NEW",
      versionId: "ver-1",
      version: 1,
      revised: false,
      pageCount: 3,
      previewCount: 3,
      formats: ["docx", "pdf"],
      route: "/workspace/documents/DOC-NEW",
      warnings: [],
      ...overrides,
    },
  };
}

describe.each(TOOLS)("$name", ({ name, create, required }) => {
  it("is a document-pack write tool with an outline schema and a provenance-free description", () => {
    const definition = documentPack.definitions.find((d) => d.name === name);
    expect(definition).toBeDefined();
    expect(definition!.sideEffect).toBe(true);
    expect(definition!.inputSchema.required).toEqual(required);
    expect(definition!.inputSchema.properties).toHaveProperty("documentId");
    expect(definition!.description).not.toMatch(/BI-|Phase \d|apps\/web|EP-/);
    expect(typeof documentPack.handlers[name]).toBe("function");
  });

  it("is gated by document_write, from one grant source", () => {
    expect(documentPack.grants[name]).toEqual(DOCUMENT_FAMILY_TOOL_GRANTS[name]);
    expect(DOCUMENT_TOOL_GRANTS[name as keyof typeof DOCUMENT_TOOL_GRANTS]).toEqual(DOCUMENT_FAMILY_TOOL_GRANTS[name]);
    expect(isToolAllowedByGrants(name, ["document_write"])).toBe(true);
    expect(isToolAllowedByGrants(name, ["document_read", "marketing_write", "payables_read"])).toBe(false);
  });

  it("passes the outline through, attributes the document to the calling coworker and returns where to review it", async () => {
    create.mockResolvedValue(created());
    const outline = { title: "Quarter", sections: [] };
    const result = await documentPack.handlers[name]!(outline, "user-1", { agentId: "AGT-WS-FINANCE" });

    expect(create).toHaveBeenCalledWith({ outline, actorPrincipalId: "principal-finance" });
    expect(result.success).toBe(true);
    expect(result.entityId).toBe("DOC-NEW");
    expect(result.message).toMatch(/^Created .* DOC-NEW v1/);
    expect(result.message).toContain("docx and pdf");
    expect(result.message).toContain("/workspace/documents/DOC-NEW");
  });

  it("reports a revision as a new version of the same document", async () => {
    create.mockResolvedValue(created({ documentId: "DOC-OLD", version: 2, revised: true, route: "/workspace/documents/DOC-OLD" }));
    const result = await documentPack.handlers[name]!({ documentId: "DOC-OLD" }, "user-1", {});
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/^Revised .* DOC-OLD v2/);
  });

  it("returns the failure the coworker must act on, without throwing", async () => {
    create.mockResolvedValue({ ok: false, reason: "invalid-outline", error: "The outline is invalid: title: Required" });
    const result = await documentPack.handlers[name]!({}, "user-1", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("title: Required");
    expect((result.data as { reason?: string }).reason).toBe("invalid-outline");
  });
});

describe("create_drawing", () => {
  it("is also reachable with ea_drawing_export, so the EA architect draws without a general document write", () => {
    expect(isToolAllowedByGrants("create_drawing", ["ea_drawing_export"])).toBe(true);
    expect(isToolAllowedByGrants("create_report", ["ea_drawing_export"])).toBe(false);
    expect(isToolAllowedByGrants("doc_save", ["ea_drawing_export"])).toBe(false);
  });
});
