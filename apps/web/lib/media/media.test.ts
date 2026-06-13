import { describe, expect, it } from "vitest";
import { probeImage } from "./image-probe";
import { buildMediaBlobStorageKey, hashMediaBlobContent } from "./media-storage";
import { normalizeRenditionWidth, RENDITION_WIDTHS } from "./renditions";
import { decodeDataUri } from "./logo-ingest";

function pngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24);
  // PNG signature
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  // IHDR length + type (not validated by the probe) then width/height BE at 16/20
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function gifHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(10);
  buf.write("GIF89a", 0, "ascii");
  buf.writeUInt16LE(width, 6);
  buf.writeUInt16LE(height, 8);
  return buf;
}

describe("probeImage", () => {
  it("reads PNG mime + dimensions", () => {
    expect(probeImage(pngHeader(640, 480))).toEqual({
      mimeType: "image/png",
      width: 640,
      height: 480,
    });
  });

  it("reads GIF mime + dimensions", () => {
    expect(probeImage(gifHeader(120, 90))).toEqual({
      mimeType: "image/gif",
      width: 120,
      height: 90,
    });
  });

  it("recognises a JPEG SOI even when dimensions are not in the first bytes", () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const result = probeImage(buf);
    expect(result.mimeType).toBe("image/jpeg");
  });

  it("returns nulls for non-image bytes", () => {
    expect(probeImage(Buffer.from("not an image at all"))).toEqual({
      mimeType: null,
      width: null,
      height: null,
    });
  });
});

describe("media storage keys", () => {
  it("hashes content to a 64-char sha256", () => {
    const sha = hashMediaBlobContent(Buffer.from("hello"));
    expect(sha).toMatch(/^[a-f0-9]{64}$/);
  });

  it("builds a sharded, content-addressed key", () => {
    const sha = hashMediaBlobContent(Buffer.from("hello"));
    const key = buildMediaBlobStorageKey(sha);
    expect(key).toBe(`media/sha256/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}`);
  });

  it("rejects a non-sha256 key", () => {
    expect(() => buildMediaBlobStorageKey("nope")).toThrow();
  });

  it("identical bytes hash identically (dedupe guarantee)", () => {
    expect(hashMediaBlobContent(Buffer.from("abc"))).toBe(hashMediaBlobContent(Buffer.from("abc")));
  });
});

describe("normalizeRenditionWidth", () => {
  it("snaps a requested width up to the nearest rung", () => {
    expect(normalizeRenditionWidth(100)).toBe(160);
    expect(normalizeRenditionWidth(200)).toBe(320);
    expect(normalizeRenditionWidth(640)).toBe(640);
    expect(normalizeRenditionWidth(700)).toBe(960);
  });

  it("caps at the largest rung", () => {
    expect(normalizeRenditionWidth(5000)).toBe(RENDITION_WIDTHS[RENDITION_WIDTHS.length - 1]);
  });

  it("rejects invalid widths (serve original)", () => {
    expect(normalizeRenditionWidth(0)).toBeNull();
    expect(normalizeRenditionWidth(-10)).toBeNull();
    expect(normalizeRenditionWidth(null)).toBeNull();
    expect(normalizeRenditionWidth(Number.NaN)).toBeNull();
  });
});

describe("decodeDataUri (logo ingest)", () => {
  it("decodes a base64 data URI to bytes + mime", () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const uri = `data:image/png;base64,${bytes.toString("base64")}`;
    const decoded = decodeDataUri(uri);
    expect(decoded?.mimeType).toBe("image/png");
    expect(decoded?.content.equals(bytes)).toBe(true);
  });

  it("returns null for an empty payload or a non-data URL", () => {
    expect(decodeDataUri("data:image/png;base64,")).toBeNull();
    expect(decodeDataUri("https://example.com/logo.png")).toBeNull();
  });
});
