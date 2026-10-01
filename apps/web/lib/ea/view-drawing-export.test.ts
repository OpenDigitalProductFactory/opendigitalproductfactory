// EA view drawing export runtime (BI-4C17BF51, slice S8 of BI-815D40C6).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RenderDocumentRequest, RenderResult, RenderedDocument } from "@/lib/documents/generation/render";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import {
  DEFAULT_DRAWING_TOKENS,
  exportEaViewDrawingFile,
  resolveDrawingTokens,
  saveEaViewDrawing,
  type EaDrawingExportDeps,
} from "./view-drawing-export";
import type { EaViewForDrawing } from "./view-drawing";

const VIEW: EaViewForDrawing = {
  name: "Order platform",
  elements: [
    {
      viewElementId: "ve-a",
      parentViewElementId: null,
      orderIndex: null,
      rendererHint: null,
      mode: "new",
      proposedProperties: null,
      elementType: { slug: "business_actor", name: "Business Actor", neoLabel: "ArchiMate__BusinessActor" },
      element: { name: "Customer" },
    },
  ],
  edges: [],
  canvasState: null,
};

function rendered(overrides: Partial<RenderedDocument> = {}): RenderedDocument {
  return {
    family: "drawing",
    title: "Order platform",
    files: [],
    previews: [Buffer.from("png-page-1")],
    text: "Customer",
    pageCount: 1,
    warnings: [],
    ...overrides,
  };
}

function deps(overrides: Partial<EaDrawingExportDeps> = {}) {
  const render = vi.fn(async (request: RenderDocumentRequest): Promise<RenderResult> => ({
    ok: true,
    data: rendered({
      files: request.formats.map((format) => ({ format, bytes: Buffer.from(`${format}-bytes`), mime: `mime/${format}` })),
    }),
  }));
  return {
    render,
    loadView: vi.fn(async () => VIEW),
    loadTokens: vi.fn(async () => DEFAULT_DRAWING_TOKENS),
    ...overrides,
  } as EaDrawingExportDeps & { render: typeof render };
}

describe("resolveDrawingTokens", () => {
  it("uses the light-mode defaults from globals.css when no brand overrides them", () => {
    const css = readFileSync(resolve(__dirname, "../../app/globals.css"), "utf8");
    const root = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")));
    expect(root).toContain(`--dpf-accent: ${DEFAULT_DRAWING_TOKENS.accent};`);
    expect(root).toContain(`--dpf-text: ${DEFAULT_DRAWING_TOKENS.text};`);
    expect(resolveDrawingTokens(null)).toEqual(DEFAULT_DRAWING_TOKENS);
  });

  it("takes the organization brand's light palette, the one printed documents use", () => {
    const tokens = { light: { palette: { accent: "#AA3300", text: "#102030" } }, dark: { palette: { accent: "#ffffff", text: "#000000" } } };
    expect(resolveDrawingTokens(tokens)).toEqual({ accent: "#aa3300", text: "#102030" });
  });

  it("reads legacy flat tokens and keeps the default for a value that is not a colour", () => {
    expect(resolveDrawingTokens({ palette: { accent: "#abc", text: "var(--x)" } })).toEqual({ accent: "#aabbcc", text: DEFAULT_DRAWING_TOKENS.text });
  });
});

describe("exportEaViewDrawingFile", () => {
  it.each([
    ["odg", "Order platform.odg"],
    ["svg", "Order platform.svg"],
    ["pdf", "Order platform.pdf"],
  ] as const)("renders a %s file of the view", async (format, fileName) => {
    const d = deps();
    const result = await exportEaViewDrawingFile({ viewId: "view-1", format }, d);
    expect(result).toEqual({ ok: true, data: { fileName, mimeType: `mime/${format}`, bytes: Buffer.from(`${format}-bytes`) } });
    const request = d.render.mock.calls[0]![0];
    expect(request.formats).toEqual([format]);
    expect(request.content.family).toBe("drawing");
    expect(request.previews).toEqual({ maxPages: 0, dpi: 48 });
  });

  it("renders a PNG as the first page preview of the PDF, at print resolution", async () => {
    const d = deps();
    const result = await exportEaViewDrawingFile({ viewId: "view-1", format: "png" }, d);
    expect(result).toEqual({ ok: true, data: { fileName: "Order platform.png", mimeType: "image/png", bytes: Buffer.from("png-page-1") } });
    expect(d.render.mock.calls[0]![0]).toMatchObject({ formats: ["pdf"], previews: { maxPages: 1, dpi: 150 } });
  });

  it("uses the resolved --dpf-* tokens for connectors and text", async () => {
    const d = deps({ loadTokens: vi.fn(async () => ({ accent: "#123456", text: "#654321" })) });
    await exportEaViewDrawingFile({ viewId: "view-1", format: "svg" }, d);
    const content = d.render.mock.calls[0]![0].content;
    expect(content.family === "drawing" && content.pages[0]!.shapes[0]).toMatchObject({ textColour: "#654321" });
  });

  it("reports a missing view without starting the engine", async () => {
    const d = deps({ loadView: vi.fn(async () => null) });
    expect(await exportEaViewDrawingFile({ viewId: "nope", format: "odg" }, d)).toEqual({ ok: false, error: "EA view nope was not found." });
    expect(d.render).not.toHaveBeenCalled();
  });

  it("passes the engine's typed failure through", async () => {
    const d = deps({ render: vi.fn(async () => ({ ok: false as const, error: "no dpf-doctools image is configured", reason: "converter-unavailable" as const })) });
    expect(await exportEaViewDrawingFile({ viewId: "view-1", format: "pdf" }, d)).toEqual({
      ok: false,
      error: "The drawing could not be rendered: no dpf-doctools image is configured",
    });
  });
});

describe("saveEaViewDrawing", () => {
  it("renders odg, svg and pdf with a PNG preview and stores them as one document", async () => {
    const save = vi.fn(async () => ({
      documentId: "DOC-1",
      versionId: "ver-1",
      version: 1,
      files: [{ format: "odg", mime: "mime/odg", blobId: "b-odg", sha256: "s" }],
      previews: [{ page: 1, blobId: "b-png", sha256: "p" }],
    }));
    const d = deps({ save, loadOrganizationId: vi.fn(async () => "org-1") });
    const result = await saveEaViewDrawing({ viewId: "view-1", actorPrincipalId: "pr-1" }, d);
    expect(d.render.mock.calls[0]![0]).toMatchObject({ formats: ["odg", "svg", "pdf"], previews: { maxPages: 1, dpi: 96 } });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ family: "drawing" }), {
      organizationId: "org-1",
      title: "Order platform",
      tags: ["ea-view", "ea-view:view-1"],
      actorPrincipalId: "pr-1",
    });
    expect(result).toMatchObject({ ok: true, data: { documentId: "DOC-1", href: "/workspace/documents/DOC-1", shapeCount: 1, connectorCount: 0 } });
  });
});
