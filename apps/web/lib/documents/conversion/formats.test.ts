import { describe, expect, it } from "vitest";
import {
  CONVERTER_SOURCE_EXTENSIONS,
  OFFICE_SOURCE_MIME_TYPES,
  TEXT_ONLY_SOURCE_MIME_TYPES,
  officeSourceExtension,
  textOnlySourceExtension,
} from "./formats";

describe("office source formats (BI-9D43CBEF)", () => {
  it("maps each office MIME type to an extension dpf-convert accepts", () => {
    for (const mime of OFFICE_SOURCE_MIME_TYPES) {
      const extension = officeSourceExtension(mime);
      expect(extension, mime).not.toBeNull();
      expect(CONVERTER_SOURCE_EXTENSIONS.has(extension!), mime).toBe(true);
    }
  });

  it("recognises word, spreadsheet and presentation files across OOXML, ODF and legacy binaries", () => {
    expect(officeSourceExtension("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("docx");
    expect(officeSourceExtension("application/vnd.openxmlformats-officedocument.presentationml.presentation")).toBe("pptx");
    expect(officeSourceExtension("application/vnd.ms-excel")).toBe("xls");
    expect(officeSourceExtension("application/vnd.oasis.opendocument.text")).toBe("odt");
    expect(officeSourceExtension("application/msword")).toBe("doc");
    expect(officeSourceExtension("application/rtf")).toBe("rtf");
  });

  it("normalises case and MIME parameters", () => {
    expect(officeSourceExtension("  Application/MSWord; charset=binary ")).toBe("doc");
  });

  it("does not treat text, markdown or PDF documents as office files", () => {
    for (const format of ["text/markdown", "text/plain", "text/html", "application/pdf", "", "docx"]) {
      expect(officeSourceExtension(format), format).toBeNull();
    }
  });

});

describe("text-only sources (BI-26CD1D1E)", () => {
  it("reads a PDF for its text through the engine's pdftotext path", () => {
    expect(TEXT_ONLY_SOURCE_MIME_TYPES).toEqual(["application/pdf"]);
    expect(textOnlySourceExtension("Application/PDF; name=x.pdf")).toBe("pdf");
    expect(CONVERTER_SOURCE_EXTENSIONS.has("pdf")).toBe(true);
  });

  it("is null for office files and plain text, which have their own paths", () => {
    for (const format of ["application/msword", "text/plain", "text/markdown", ""]) {
      expect(textOnlySourceExtension(format), format).toBeNull();
    }
  });
});
