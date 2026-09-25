import { describe, expect, it, vi } from "vitest";
import {
  createPresentation,
  outlineToDeckSpec,
  type CreatePresentationDeps,
  type PresentationOutline,
} from "./create-presentation";
import type { RenderDocumentRequest, RenderedDocument } from "./render";

vi.mock("@dpf/db", () => ({ prisma: {}, DocumentRenditionKind: { pdf: "pdf", plain_text: "plain_text", preview: "preview" } }));

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** A six-slide campaign outline, the shape a marketing coworker drafts. */
function campaignOutline(overrides: Partial<PresentationOutline> = {}): PresentationOutline {
  return {
    title: "Spring adoption drive",
    subtitle: "Campaign plan for the board",
    audience: "Board and volunteer leads",
    goal: "Approve a six-week adoption push",
    slides: [
      { title: "Spring adoption drive" },
      { title: "Where we are", bullets: ["42 adoptions this quarter", "12 foster homes"], notes: "Lead with the foster numbers." },
      {
        title: "Adoptions by month",
        chart: { type: "column", categories: ["Jan", "Feb", "Mar"], series: [{ name: "Dogs", values: [10, 14, 18] }] },
      },
      { title: "The plan", layout: "section", subtitle: "Six weeks, three channels" },
      { title: "Channels and budget", table: { columns: ["Channel", "Budget"], rows: [["Email", 0], ["Social", 150]] } },
      { title: "The ask", bullets: ["Approve the budget", "Name a volunteer lead"] },
    ],
    ...overrides,
  };
}

function rendered(request: RenderDocumentRequest): RenderedDocument {
  const slides = request.content.family === "deck" ? request.content.slides.length : 1;
  return {
    family: "deck",
    title: request.content.title,
    files: [
      { format: "pptx", bytes: Buffer.from("PK-pptx"), mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
      { format: "pdf", bytes: Buffer.from("%PDF-1.7"), mime: "application/pdf" },
    ],
    previews: Array.from({ length: slides }, (_, index) => Buffer.from(`png-${index + 1}`)),
    text: "Spring adoption drive",
    pageCount: slides,
    warnings: [],
  };
}

function harness(overrides: Partial<CreatePresentationDeps> = {}) {
  const render = vi.fn(async (request: RenderDocumentRequest) => ({ ok: true as const, data: rendered(request) }));
  const save = vi.fn(async (doc: RenderedDocument, target: { documentId?: string | null }) => ({
    documentId: target.documentId ?? "DOC-NEW",
    versionId: target.documentId ? "ver-2" : "ver-1",
    version: target.documentId ? 2 : 1,
    files: doc.files.map((file, index) => ({ format: file.format, mime: file.mime, blobId: `blob-${index}`, sha256: `sha-${index}` })),
    previews: doc.previews.map((_, index) => ({ page: index + 1, blobId: `png-${index}`, sha256: `psha-${index}` })),
  }));
  const loadDocument = vi.fn(async (documentId: string) =>
    documentId === "DOC-DECK"
      ? { documentKind: "generated-deck", organizationId: "org-deck" }
      : documentId === "DOC-POLICY"
        ? { documentKind: "policy", organizationId: "org-1" }
        : null,
  );
  const loadImage = vi.fn(async (documentId: string) =>
    documentId === "DOC-PHOTO" ? { data: PNG_1PX, mimeType: "image/png" as const } : null,
  );
  const deps: CreatePresentationDeps = {
    render,
    save,
    loadDocument,
    loadImage,
    resolveOrganizationId: async () => "org-1",
    ...overrides,
  };
  return { deps, render, save, loadDocument, loadImage };
}

describe("outlineToDeckSpec", () => {
  it("maps each outline slide to one deck slide, inferring the layout from what the slide carries", () => {
    const spec = outlineToDeckSpec(campaignOutline());
    expect(spec.family).toBe("deck");
    expect(spec.title).toBe("Spring adoption drive");
    expect(spec.subject).toBe("Approve a six-week adoption push");
    expect(spec.slides.map((slide) => slide.layout)).toEqual(["title", "bullets", "chart", "section", "table", "bullets"]);
    // The opening slide carries the deck subtitle when it has none of its own.
    expect(spec.slides[0]).toMatchObject({ layout: "title", subtitle: "Campaign plan for the board" });
    expect(spec.slides[1]).toMatchObject({ bullets: ["42 adoptions this quarter", "12 foster homes"], notes: "Lead with the foster numbers." });
    expect(spec.slides[3]).toMatchObject({ layout: "section", subtitle: "Six weeks, three channels" });
  });

  it("puts the audience and goal where the brand master's placeholders can use them", () => {
    const spec = outlineToDeckSpec(campaignOutline());
    expect(spec.fields).toEqual({ audience: "Board and volunteer leads", goal: "Approve a six-week adoption push" });
  });

  it("turns a later slide with only a title into a section divider", () => {
    const spec = outlineToDeckSpec(campaignOutline({ slides: [{ title: "Opening" }, { title: "Part two" }] }));
    expect(spec.slides.map((slide) => slide.layout)).toEqual(["title", "section"]);
  });
});

describe("createPresentation", () => {
  it("renders the outline in the organization's brand master as a pptx and a pdf, and stores a new document", async () => {
    const { deps, render, save } = harness();
    const result = await createPresentation({ outline: campaignOutline(), actorPrincipalId: "p-agent" }, deps);

    if (!result.ok) throw new Error(result.error);
    expect(render).toHaveBeenCalledTimes(1);
    const request = render.mock.calls[0]![0];
    expect(request.templateRef).toEqual({ kind: "brand-master", organizationId: "org-1" });
    expect(request.formats).toEqual(["pptx", "pdf"]);
    expect(request.content).toEqual(outlineToDeckSpec(campaignOutline()));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ family: "deck" }),
      expect.objectContaining({ organizationId: "org-1", documentId: null, actorPrincipalId: "p-agent" }),
    );
    expect(result.data).toMatchObject({ documentId: "DOC-NEW", version: 1, slideCount: 6, previewCount: 6, revised: false });
    expect(result.data.route).toBe("/workspace/documents/DOC-NEW");
  });

  it("revises an existing presentation as a new version of the same document, in that document's organization", async () => {
    const { deps, render, save } = harness();
    const result = await createPresentation({ outline: campaignOutline({ documentId: "DOC-DECK" }) }, deps);

    if (!result.ok) throw new Error(result.error);
    expect(render.mock.calls[0]![0].templateRef).toEqual({ kind: "brand-master", organizationId: "org-deck" });
    expect(save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ documentId: "DOC-DECK", organizationId: "org-deck" }));
    expect(result.data).toMatchObject({ documentId: "DOC-DECK", version: 2, revised: true });
  });

  it("refuses to revise a document that is not a generated presentation", async () => {
    const { deps, render, save } = harness();
    const result = await createPresentation({ outline: campaignOutline({ documentId: "DOC-POLICY" }) }, deps);
    expect(result).toMatchObject({ ok: false, reason: "not-a-presentation" });
    expect(render).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("refuses to revise a document that does not exist", async () => {
    const { deps, render } = harness();
    const result = await createPresentation({ outline: campaignOutline({ documentId: "DOC-GONE" }) }, deps);
    expect(result).toMatchObject({ ok: false, reason: "document-not-found" });
    expect(render).not.toHaveBeenCalled();
  });

  it("resolves an image slide's documentId to the stored image's bytes", async () => {
    const { deps, render, loadImage } = harness();
    const outline = campaignOutline({
      slides: [{ title: "Meet Biscuit", image: { documentId: "DOC-PHOTO", alt: "Biscuit on the porch" }, caption: "Adopted in March" }],
    });
    const result = await createPresentation({ outline }, deps);

    if (!result.ok) throw new Error(result.error);
    expect(loadImage).toHaveBeenCalledWith("DOC-PHOTO");
    const content = render.mock.calls[0]![0].content;
    expect(content.family === "deck" && content.slides[0]).toMatchObject({
      layout: "image",
      image: { data: PNG_1PX, mimeType: "image/png", alt: "Biscuit on the porch" },
      caption: "Adopted in March",
    });
  });

  it("names the slide whose image reference is not a stored image, before any render", async () => {
    const { deps, render } = harness();
    const outline = campaignOutline({ slides: [{ title: "Photo", image: { documentId: "DOC-POLICY", alt: "?" } }] });
    const result = await createPresentation({ outline }, deps);
    expect(result).toMatchObject({ ok: false, reason: "invalid-outline" });
    if (!result.ok) expect(result.error).toContain("slides.0.image.documentId");
    expect(render).not.toHaveBeenCalled();
  });

  it("reports an invalid outline with the field path the coworker must fix", async () => {
    const { deps, render } = harness();
    const outline = campaignOutline({
      slides: [{ title: "Chart", chart: { type: "bar", categories: ["A", "B"], series: [{ name: "S", values: [1] }] } }],
    });
    const result = await createPresentation({ outline }, deps);
    expect(result).toMatchObject({ ok: false, reason: "invalid-outline" });
    if (!result.ok) expect(result.error).toContain("slides.0.chart.series.0.values");
    expect(render).not.toHaveBeenCalled();
  });

  it("stores nothing when the engine is not available, and says so plainly", async () => {
    const { deps, save } = harness({
      render: vi.fn(async () => ({ ok: false as const, error: "no dpf-doctools image is configured", reason: "converter-unavailable" as const })),
    });
    const result = await createPresentation({ outline: campaignOutline() }, deps);
    expect(result).toMatchObject({ ok: false, reason: "converter-unavailable" });
    if (!result.ok) expect(result.error).toMatch(/not available on this install/i);
    expect(save).not.toHaveBeenCalled();
  });
});
