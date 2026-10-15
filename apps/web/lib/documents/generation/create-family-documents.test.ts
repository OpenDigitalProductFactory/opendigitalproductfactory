import { describe, expect, it, vi } from "vitest";
import { createDrawing, createLetter, createReport, createSheet } from "./create-family-documents";
import type { FamilyDocumentDeps } from "./family-document";
import type { RenderDocumentRequest, RenderedDocument } from "./render";
import type { DocumentFamily } from "./spec";

vi.mock("@dpf/db", () => ({ prisma: {}, DocumentRenditionKind: { pdf: "pdf", plain_text: "plain_text", preview: "preview" } }));

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const OFFICE_FORMAT: Record<DocumentFamily, string> = { deck: "pptx", report: "docx", letter: "docx", sheet: "xlsx", drawing: "odg" };

function rendered(request: RenderDocumentRequest): RenderedDocument {
  return {
    family: request.content.family,
    title: request.content.title,
    files: request.formats.map((format) => ({ format, bytes: Buffer.from(`bytes-${format}`), mime: `mime/${format}` })),
    previews: [Buffer.from("png-1"), Buffer.from("png-2")],
    text: request.content.title,
    pageCount: 2,
    warnings: [],
  };
}

/** A store holding one generated document of each family in org-1, a policy, and a report in another organization. */
function harness(overrides: Partial<FamilyDocumentDeps> = {}) {
  const render = vi.fn(async (request: RenderDocumentRequest) => ({ ok: true as const, data: rendered(request) }));
  const save = vi.fn(async (doc: RenderedDocument, target: { documentId?: string | null }) => ({
    documentId: target.documentId ?? "DOC-NEW",
    versionId: target.documentId ? "ver-2" : "ver-1",
    version: target.documentId ? 2 : 1,
    files: doc.files.map((file, index) => ({ format: file.format, mime: file.mime, blobId: `blob-${index}`, sha256: `sha-${index}` })),
    previews: doc.previews.map((_, index) => ({ page: index + 1, blobId: `png-${index}`, sha256: `psha-${index}` })),
  }));
  const documents: Record<string, { documentKind: string; organizationId: string }> = {
    "DOC-REPORT": { documentKind: "generated-report", organizationId: "org-1" },
    "DOC-LETTER": { documentKind: "generated-letter", organizationId: "org-1" },
    "DOC-SHEET": { documentKind: "generated-sheet", organizationId: "org-1" },
    "DOC-DRAWING": { documentKind: "generated-drawing", organizationId: "org-1" },
    "DOC-POLICY": { documentKind: "policy", organizationId: "org-1" },
    "DOC-OTHER-ORG": { documentKind: "generated-report", organizationId: "org-2" },
  };
  const loadDocument = vi.fn(async (documentId: string) => documents[documentId] ?? null);
  const loadImage = vi.fn(async (documentId: string, organizationId: string) =>
    documentId === "DOC-PHOTO" && organizationId === "org-1" ? { data: PNG_1PX, mimeType: "image/png" as const } : null,
  );
  const deps: FamilyDocumentDeps = {
    render,
    save,
    loadDocument,
    loadImage,
    resolveOrganizationId: async () => "org-1",
    now: () => new Date("2026-10-14T12:00:00Z"),
    ...overrides,
  };
  return { deps, render, save, loadImage };
}

const REPORT = {
  title: "Third quarter operations",
  sections: [{ heading: "Adoptions", paragraphs: ["We placed 42 animals."] }],
};
const LETTER = {
  subject: "Your gift",
  recipient: { name: "Ada Lovelace" },
  paragraphs: ["Thank you."],
  signatureName: "Grace Hopper",
};
const SHEET = { title: "Donations", columns: ["Month", "Amount"], rows: [["Jan", 100]] };
const DRAWING = { title: "Intake flow", shapes: [{ id: "a", label: "Intake" }, { id: "b", label: "Vet" }], connectors: [{ from: "a", to: "b" }] };

const FAMILIES = [
  { family: "report", create: createReport, outline: REPORT, existing: "DOC-REPORT", formats: ["docx", "pdf"] },
  { family: "letter", create: createLetter, outline: LETTER, existing: "DOC-LETTER", formats: ["docx", "pdf"] },
  { family: "sheet", create: createSheet, outline: SHEET, existing: "DOC-SHEET", formats: ["xlsx", "pdf"] },
  { family: "drawing", create: createDrawing, outline: DRAWING, existing: "DOC-DRAWING", formats: ["odg", "svg", "pdf"] },
] as const;

describe.each(FAMILIES)("create $family", ({ family, create, outline, existing, formats }) => {
  it("renders the outline in the organization's brand master as its office file and a PDF with previews, stored as a new document", async () => {
    const { deps, render, save } = harness();
    const result = await create({ outline: outline as never, actorPrincipalId: "p-agent" }, deps);

    if (!result.ok) throw new Error(result.error);
    const request = render.mock.calls[0]![0];
    expect(request.content.family).toBe(family);
    expect(request.templateRef).toEqual({ kind: "brand-master", organizationId: "org-1" });
    expect(request.formats).toEqual(formats);
    expect(request.formats[0]).toBe(OFFICE_FORMAT[family]);
    expect(request.previews?.maxPages).toBeGreaterThan(0);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ family }),
      expect.objectContaining({ organizationId: "org-1", documentId: null, actorPrincipalId: "p-agent", tags: [family] }),
    );
    expect(result.data).toMatchObject({ documentId: "DOC-NEW", version: 1, revised: false, previewCount: 2, pageCount: 2 });
    expect(result.data.formats).toEqual(formats);
    expect(result.data.route).toBe("/workspace/documents/DOC-NEW");
  });

  it("revises its own kind of generated document as the next version of the same document", async () => {
    const { deps, save } = harness();
    const result = await create({ outline: { ...outline, documentId: existing } as never }, deps);

    if (!result.ok) throw new Error(result.error);
    expect(save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ documentId: existing, organizationId: "org-1" }));
    expect(result.data).toMatchObject({ documentId: existing, version: 2, revised: true });
  });

  it("refuses to revise a document of another kind, before any render", async () => {
    const { deps, render, save } = harness();
    const result = await create({ outline: { ...outline, documentId: "DOC-POLICY" } as never }, deps);
    expect(result).toMatchObject({ ok: false, reason: "wrong-document-kind" });
    if (!result.ok) expect(result.error).toContain(`create_${family}`);
    expect(render).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("tenant isolation", () => {
  it("does not reveal or revise a document that belongs to another organization", async () => {
    const { deps, render, save } = harness();
    const result = await createReport({ outline: { ...REPORT, documentId: "DOC-OTHER-ORG" } }, deps);
    expect(result).toMatchObject({ ok: false, reason: "document-not-found" });
    if (!result.ok) expect(result.error).not.toContain("org-2");
    expect(render).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("loads a stored image only from the caller's organization", async () => {
    const { deps, render, loadImage } = harness({ resolveOrganizationId: async () => "org-2" });
    const outline = {
      title: "Photo report",
      sections: [{ heading: "Biscuit", image: { documentId: "DOC-PHOTO", alt: "Biscuit" } }],
    };
    const result = await createReport({ outline }, deps);
    expect(loadImage).toHaveBeenCalledWith("DOC-PHOTO", "org-2");
    expect(result).toMatchObject({ ok: false, reason: "invalid-outline" });
    if (!result.ok) expect(result.error).toContain("sections.0.image.documentId");
    expect(render).not.toHaveBeenCalled();
  });
});

describe("validation before any container runs (AC-2)", () => {
  it.each([
    ["report", () => createReport({ outline: { title: "R", sections: [{ heading: "H", table: { columns: ["A"], rows: [[1, 2]] } }] } }, harness().deps), "sections.0.blocks.0.table.rows.0"],
    ["letter", () => createLetter({ outline: { ...LETTER, recipient: { name: "" } } }, harness().deps), "recipient.name"],
    ["sheet", () => createSheet({ outline: { title: "S", columns: ["A"], rows: [[{ formula: "=WEBSERVICE(\"http://x\")" }]] } }, harness().deps), "sheets.0.rows.0.0.formula"],
    ["drawing", () => createDrawing({ outline: { title: "D", shapes: [{ id: "a" }], connectors: [{ from: "a", to: "ghost" }] } }, harness().deps), "pages.0.connectors.0.to"],
  ])("refuses an invalid %s with the field path to fix", async (_family, run, path) => {
    const result = await run();
    expect(result).toMatchObject({ ok: false, reason: "invalid-outline" });
    if (!result.ok) expect(result.error).toContain(path);
  });

  it("starts no render for an invalid spec", async () => {
    const { deps, render } = harness();
    await createSheet({ outline: { title: "", columns: [], rows: [] } }, deps);
    expect(render).not.toHaveBeenCalled();
  });
});

describe("engine failures", () => {
  it("stores nothing when the engine is not available, and says so in the family's words", async () => {
    const { deps, save } = harness({
      render: vi.fn(async () => ({ ok: false as const, error: "no dpf-doctools image is configured", reason: "converter-unavailable" as const })),
    });
    const result = await createLetter({ outline: LETTER }, deps);
    expect(result).toMatchObject({ ok: false, reason: "converter-unavailable" });
    if (!result.ok) expect(result.error).toMatch(/^Letters cannot be produced right now.*not available on this install/);
    expect(save).not.toHaveBeenCalled();
  });

  it("reports a save failure without claiming the document exists", async () => {
    const { deps } = harness({ save: vi.fn(async () => Promise.reject(new Error("disk full"))) });
    const result = await createSheet({ outline: SHEET }, deps);
    expect(result).toMatchObject({ ok: false, reason: "render-failed" });
    if (!result.ok) expect(result.error).toContain("disk full");
  });
});
