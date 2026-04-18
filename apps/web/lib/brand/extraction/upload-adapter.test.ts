import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sharp: vi.fn(),
  pdfParse: vi.fn(),
  mammothExtractRawText: vi.fn(),
}));

vi.mock("sharp", () => ({
  default: (buffer: Buffer) => mocks.sharp(buffer),
}));

vi.mock("pdf-parse", () => ({
  default: (buffer: Buffer) => mocks.pdfParse(buffer),
}));

vi.mock("mammoth", () => ({
  default: { extractRawText: (args: unknown) => mocks.mammothExtractRawText(args) },
  extractRawText: (args: unknown) => mocks.mammothExtractRawText(args),
}));

import { uploadAdapter } from "./upload-adapter";

describe("uploadAdapter", () => {
  beforeEach(() => {
    mocks.sharp.mockReset();
    mocks.pdfParse.mockReset();
    mocks.mammothExtractRawText.mockReset();
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

  it("captures PDF text into identity.description with low confidence", async () => {
    mocks.pdfParse.mockResolvedValue({
      text: "Acme Corporation brand guidelines. We make widgets that delight.",
    });

    const result = await uploadAdapter([
      { name: "brand.pdf", mimeType: "application/pdf", data: Buffer.from([0x25, 0x50, 0x44, 0x46]) },
    ]);

    expect(result.identity?.description).toContain("Acme Corporation");
    expect(result.confidence?.perField?.["identity.description"]).toBeLessThanOrEqual(0.5);
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
