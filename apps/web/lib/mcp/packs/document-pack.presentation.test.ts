import { beforeEach, describe, expect, it, vi } from "vitest";

const presentation = vi.hoisted(() => ({ createPresentation: vi.fn() }));
vi.mock("@/lib/documents/generation/create-presentation", () => presentation);

const principalLinking = vi.hoisted(() => ({
  ensureAgentPrincipalIdentity: vi.fn(),
  syncUserPrincipal: vi.fn(),
}));
vi.mock("@/lib/identity/principal-linking", () => principalLinking);

import { documentPack } from "./document-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

beforeEach(() => {
  vi.clearAllMocks();
  principalLinking.ensureAgentPrincipalIdentity.mockResolvedValue({ id: "principal-marketing" });
  principalLinking.syncUserPrincipal.mockResolvedValue({ id: "principal-user" });
});

const OUTLINE = {
  title: "Spring adoption drive",
  slides: [{ title: "Spring adoption drive" }, { title: "Where we are", bullets: ["42 adoptions"] }],
};

describe("create_presentation", () => {
  it("is a document-pack write tool gated by document_write", () => {
    const definition = documentPack.definitions.find((d) => d.name === "create_presentation");
    expect(definition).toBeDefined();
    expect(definition!.sideEffect).toBe(true);
    expect(definition!.inputSchema.required).toEqual(["title", "slides"]);
    expect(documentPack.grants.create_presentation).toEqual(["document_write"]);
    expect(isToolAllowedByGrants("create_presentation", ["document_write"])).toBe(true);
    expect(isToolAllowedByGrants("create_presentation", ["document_read", "marketing_write"])).toBe(false);
  });

  it("passes the outline through and attributes the deck to the calling coworker", async () => {
    presentation.createPresentation.mockResolvedValue({
      ok: true,
      data: {
        documentId: "DOC-NEW",
        versionId: "ver-1",
        version: 1,
        revised: false,
        slideCount: 2,
        previewCount: 2,
        formats: ["pptx", "pdf"],
        route: "/workspace/documents/DOC-NEW",
        warnings: [],
      },
    });
    const result = await documentPack.handlers.create_presentation!(OUTLINE, "user-1", { agentId: "AGT-WS-MARKETING" });

    expect(presentation.createPresentation).toHaveBeenCalledWith({ outline: OUTLINE, actorPrincipalId: "principal-marketing" });
    expect(result.success).toBe(true);
    expect(result.entityId).toBe("DOC-NEW");
    expect(result.message).toContain("/workspace/documents/DOC-NEW");
    expect(result.message).toContain("2 slides");
  });

  it("reports a revision as a new version of the same document", async () => {
    presentation.createPresentation.mockResolvedValue({
      ok: true,
      data: {
        documentId: "DOC-DECK",
        versionId: "ver-2",
        version: 2,
        revised: true,
        slideCount: 2,
        previewCount: 2,
        formats: ["pptx", "pdf"],
        route: "/workspace/documents/DOC-DECK",
        warnings: [],
      },
    });
    const result = await documentPack.handlers.create_presentation!({ ...OUTLINE, documentId: "DOC-DECK" }, "user-1", {});
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/DOC-DECK v2/);
  });

  it("returns the failure the coworker must act on, without throwing", async () => {
    presentation.createPresentation.mockResolvedValue({
      ok: false,
      reason: "invalid-outline",
      error: "The outline is invalid: slides.0.title: Required",
    });
    const result = await documentPack.handlers.create_presentation!({ title: "x", slides: [{}] }, "user-1", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("slides.0.title");
    expect((result.data as { reason?: string }).reason).toBe("invalid-outline");
  });
});
