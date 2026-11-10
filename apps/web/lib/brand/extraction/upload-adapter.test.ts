import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sharp: vi.fn(),
}));

vi.mock("sharp", () => ({
  default: (buffer: Buffer) => mocks.sharp(buffer),
}));

import type { ParsedFileContent } from "@/lib/shared/file-parsers";
import { uploadAdapter } from "./upload-adapter";

const document = (fullText: string): ParsedFileContent => ({ type: "document", summary: `${fullText.length} characters`, fullText });

describe("uploadAdapter", () => {
  beforeEach(() => {
    mocks.sharp.mockReset();
  });

  it("extracts dominant color and logo AssetRef from a PNG upload", async () => {
    mocks.sharp.mockReturnValue({
      stats: async () => ({
        dominant: { r: 51, g: 102, b: 153 },
      }),
      metadata: async () => ({ width: 512, height: 512, format: "png" }),
    });

    const result = await uploadAdapter([
      { name: "logo.png", mimeType: "image/png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    ]);

    expect(result.identity?.logo?.mark?.source).toBe("upload");
    expect(result.identity?.logo?.mark?.mimeType).toBe("image/png");
    expect(result.palette?.primary).toBe("#336699");
    expect(result.confidence?.overall ?? 0).toBeGreaterThan(0);
    expect(result.sources?.[0]?.kind).toBe("upload");
  });

  it("captures PDF text, read through the shared file reader, into identity.description with low confidence", async () => {
    const parse = vi.fn(async () => document("Acme Corporation brand guidelines. We make widgets that delight."));
    const result = await uploadAdapter(
      [{ name: "brand.pdf", mimeType: "application/pdf", data: Buffer.from([0x25, 0x50, 0x44, 0x46]) }],
      { parse },
    );

    expect(parse).toHaveBeenCalledWith(expect.any(Buffer), "application/pdf", "brand.pdf");
    expect(result.identity?.description).toContain("Acme Corporation");
    expect(result.confidence?.perField?.["identity.description"]).toBeLessThanOrEqual(0.5);
  });

  it("captures Word text the same way, capped at 2000 characters", async () => {
    const parse = vi.fn(async () => document(`We rescue dogs. ${"x".repeat(3000)}`));
    const result = await uploadAdapter(
      [{ name: "brand.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", data: Buffer.from("PK") }],
      { parse },
    );
    expect(result.identity?.description?.startsWith("We rescue dogs.")).toBe(true);
    expect(result.identity?.description?.length).toBe(2000);
  });

  it("records a gap when a document yields no text, including when the reader cannot read it", async () => {
    const unreadable: ParsedFileContent = { type: "unsupported", format: "pdf", reason: "no converter", summary: "no converter" };
    const result = await uploadAdapter(
      [
        { name: "scan.pdf", mimeType: "application/pdf", data: Buffer.from("%PDF-") },
        { name: "empty.doc", mimeType: "application/msword", data: Buffer.from("x") },
      ],
      { parse: vi.fn().mockResolvedValueOnce(unreadable).mockRejectedValueOnce(new Error("boom")) },
    );
    expect(result.gaps).toEqual(["upload-pdf-no-text:scan.pdf", "upload-docx-no-text:empty.doc"]);
    expect(result.identity?.description ?? null).toBeNull();
  });

  it("skips unsupported MIME types with a gap entry", async () => {
    const result = await uploadAdapter([
      { name: "mystery.xyz", mimeType: "application/x-mystery", data: Buffer.from([]) },
    ]);

    expect(result.gaps).toContain("upload-unsupported-mime:application/x-mystery");
    expect(result.confidence?.overall).toBe(0);
  });

  it("returns an empty partial with gap when no uploads are provided", async () => {
    const result = await uploadAdapter([]);
    expect(result.gaps).toContain("no-uploads");
    expect(result.confidence?.overall).toBe(0);
  });

  it("returns an empty partial with gap when uploads is undefined", async () => {
    const result = await uploadAdapter(undefined);
    expect(result.gaps).toContain("no-uploads");
    expect(result.confidence?.overall).toBe(0);
  });
});
