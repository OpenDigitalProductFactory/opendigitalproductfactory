import { describe, expect, it } from "vitest";
import { buildPreviewManifest, parsePreviewManifest } from "./preview-manifest";

describe("preview manifest", () => {
  it("round-trips the page images in page order", () => {
    const bytes = buildPreviewManifest([
      { page: 2, blobId: "b2", sha256: "s2" },
      { page: 1, blobId: "b1", sha256: "s1" },
    ]);
    expect(parsePreviewManifest(bytes)).toEqual({
      pages: [
        { page: 1, blobId: "b1", sha256: "s1" },
        { page: 2, blobId: "b2", sha256: "s2" },
      ],
    });
  });

  it("is deterministic, so the same previews store as the same blob", () => {
    const pages = [{ page: 1, blobId: "b1", sha256: "s1" }];
    expect(buildPreviewManifest(pages).equals(buildPreviewManifest(pages))).toBe(true);
  });

  it("reads anything malformed as no previews rather than throwing", () => {
    expect(parsePreviewManifest(Buffer.from("not json"))).toBeNull();
    expect(parsePreviewManifest(Buffer.from(JSON.stringify({ pages: [{ page: "one" }] })))).toBeNull();
    expect(parsePreviewManifest(Buffer.from(JSON.stringify({ version: 2 })))).toBeNull();
  });
});
