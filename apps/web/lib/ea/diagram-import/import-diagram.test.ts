// Diagram import into EA review (BI-4C17BF51, slice S8 import half).
import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import type { ConversionResult, ConvertRequest } from "@/lib/documents/conversion/convert";
import {
  DIAGRAM_IMPORT_KIND,
  MAX_DIAGRAM_IMPORT_BYTES,
  importDiagramFile,
  type DiagramImportDeps,
  type StagedDiagramImport,
} from "./import-diagram";

const FODG = `<?xml version="1.0"?><office:document xmlns:office="o" xmlns:draw="d" xmlns:svg="s" xmlns:text="t"><office:body><office:drawing>
<draw:page draw:name="Page-1">
<draw:rect svg:x="0cm" svg:y="0cm" svg:width="2cm" svg:height="1cm"><text:p>Customer Portal</text:p></draw:rect>
<draw:rect svg:x="5cm" svg:y="0cm" svg:width="2cm" svg:height="1cm"><text:p>Order Service</text:p></draw:rect>
<draw:line svg:x1="2cm" svg:y1="0.5cm" svg:x2="5cm" svg:y2="0.5cm"><text:p>calls</text:p></draw:line>
</draw:page></office:drawing></office:body></office:document>`;

function deps(overrides: Partial<DiagramImportDeps> = {}) {
  const convert = vi.fn(async (request: ConvertRequest): Promise<ConversionResult> => {
    if (request.to === "fodg") return { ok: true, data: { bytes: Buffer.from(FODG), mime: "application/vnd.oasis.opendocument.graphics-flat-xml" } };
    return { ok: true, data: { bytes: Buffer.from("<svg>preview</svg>"), mime: "image/svg+xml" } };
  });
  const findExisting = vi.fn(async () => null as string | null);
  const stage = vi.fn(async (_input: StagedDiagramImport) => "prop-header-1");
  return { convert, findExisting, stage, ...overrides } as DiagramImportDeps & {
    convert: typeof convert;
    findExisting: typeof findExisting;
    stage: typeof stage;
  };
}

const input = (fileName: string, bytes = Buffer.from("visio-bytes")) => ({ fileName, bytes, userId: "user-1" });

describe("importDiagramFile", () => {
  it("converts a Visio file through the engine and stages its shapes and connectors as proposals", async () => {
    const d = deps();
    const result = await importDiagramFile(input("Order platform.vsdx"), d);
    expect(d.convert).toHaveBeenCalledWith({ input: Buffer.from("visio-bytes"), from: "vsdx", to: "fodg" });
    expect(d.convert).toHaveBeenCalledWith({ input: Buffer.from("visio-bytes"), from: "vsdx", to: "svg" });
    const staged = d.stage.mock.calls[0]![0];
    expect(staged).toMatchObject({ fileName: "Order platform.vsdx", userId: "user-1", svg: Buffer.from("<svg>preview</svg>") });
    expect(staged.drawing.pages[0]!.elements.map((element) => element.label)).toEqual(["Customer Portal", "Order Service"]);
    expect(staged.drawing.pages[0]!.relationships).toEqual([{ fromKey: "p1-e1", toKey: "p1-e2", label: "calls" }]);
    expect(result).toEqual({
      ok: true,
      data: { importId: "prop-header-1", alreadyImported: false, elementCount: 2, relationshipCount: 1, unattachedConnectors: 0, pageCount: 1, truncated: false, previewAvailable: true },
    });
  });

  it.each(["diagram.vsd", "diagram.odg", "DIAGRAM.VSDX"])("accepts %s", async (fileName) => {
    const d = deps();
    expect((await importDiagramFile(input(fileName), d)).ok).toBe(true);
    expect(d.convert.mock.calls[0]![0].from).toBe(fileName.split(".").pop()!.toLowerCase());
  });

  it("refuses another file type without starting the engine", async () => {
    const d = deps();
    expect(await importDiagramFile(input("notes.docx"), d)).toEqual({ ok: false, error: "Choose a Visio (.vsd, .vsdx) or Draw (.odg) file." });
    expect(d.convert).not.toHaveBeenCalled();
  });

  it("refuses an empty or oversized file", async () => {
    const d = deps();
    expect((await importDiagramFile(input("a.vsdx", Buffer.alloc(0)), d)).ok).toBe(false);
    const big = await importDiagramFile(input("a.vsdx", Buffer.alloc(MAX_DIAGRAM_IMPORT_BYTES + 1)), d);
    expect(big).toEqual({ ok: false, error: "The file is larger than 900 KB." });
    expect(d.convert).not.toHaveBeenCalled();
  });

  it("says so plainly when the document engine is not set up", async () => {
    const d = deps({ convert: vi.fn(async () => ({ ok: false as const, error: "no image", reason: "converter-unavailable" as const })) });
    expect(await importDiagramFile(input("a.vsdx"), d)).toEqual({
      ok: false,
      error: "Diagram import needs the document engine, which is not set up on this install.",
    });
  });

  it("reports a file the engine cannot read", async () => {
    const d = deps({ convert: vi.fn(async () => ({ ok: false as const, error: "exit 3: no output", reason: "conversion-failed" as const })) });
    expect(await importDiagramFile(input("a.vsdx"), d)).toEqual({ ok: false, error: "The diagram could not be read: exit 3: no output" });
  });

  it("refuses a diagram with no labelled shapes, staging nothing", async () => {
    const empty = FODG.replace(/<draw:rect[\s\S]*<\/draw:line>/, "");
    const d = deps({ convert: vi.fn(async () => ({ ok: true as const, data: { bytes: Buffer.from(empty), mime: "x" } })) });
    expect(await importDiagramFile(input("a.odg"), d)).toEqual({ ok: false, error: "No labelled shapes were found in this diagram." });
    expect(d.stage).not.toHaveBeenCalled();
  });

  it("still stages the candidates when only the SVG preview fails", async () => {
    const convert = vi.fn(async (request: ConvertRequest): Promise<ConversionResult> =>
      request.to === "fodg" ? { ok: true, data: { bytes: Buffer.from(FODG), mime: "x" } } : { ok: false, error: "svg failed", reason: "conversion-failed" },
    );
    const d = deps({ convert });
    const result = await importDiagramFile(input("a.vsdx"), d);
    expect(d.stage.mock.calls[0]![0].svg).toBeNull();
    expect(result).toMatchObject({ ok: true, data: { previewAvailable: false } });
  });

  it("returns the earlier import for the same file instead of staging it twice", async () => {
    const d = deps({ findExisting: vi.fn(async () => "prop-header-0") });
    const result = await importDiagramFile(input("a.vsdx"), d);
    expect(result).toMatchObject({ ok: true, data: { importId: "prop-header-0", alreadyImported: true } });
    expect(d.convert).not.toHaveBeenCalled();
    expect(d.stage).not.toHaveBeenCalled();
  });

  it("names the proposal kinds it writes", () => {
    expect(DIAGRAM_IMPORT_KIND).toEqual({ import: "diagram_import", element: "diagram_import_element", relationship: "diagram_import_relationship" });
  });
});
