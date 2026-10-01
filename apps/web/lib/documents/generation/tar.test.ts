import { describe, expect, it } from "vitest";
import { readTar, writeTar } from "./tar";

describe("readTar", () => {
  it("reads every regular file of a ustar stream, in order", () => {
    const tar = writeTar([
      { name: "document.pptx", data: Buffer.from("PK\u0003\u0004pptx bytes") },
      { name: "preview-001.png", data: Buffer.alloc(1500, 7) },
      { name: "manifest.json", data: Buffer.from('{"pageCount":1}') },
    ]);
    const entries = readTar(tar);
    expect(entries.map((entry) => entry.name)).toEqual(["document.pptx", "preview-001.png", "manifest.json"]);
    expect(entries[1].data.length).toBe(1500);
    expect(entries[2].data.toString()).toBe('{"pageCount":1}');
  });

  it("refuses a truncated archive instead of returning a partial file", () => {
    const tar = writeTar([{ name: "document.pdf", data: Buffer.alloc(2000, 1) }]);
    expect(() => readTar(tar.subarray(0, 1024))).toThrow(/truncated/);
  });

  it("refuses path traversal and non-file entries", () => {
    expect(() => readTar(writeTar([{ name: "../etc/passwd", data: Buffer.from("x") }]))).toThrow(/entry name/);
    expect(() => readTar(writeTar([{ name: "dir/", data: Buffer.alloc(0), type: "5" }]))).toThrow(/regular file/);
  });

  it("refuses bytes that are not a tar archive", () => {
    expect(() => readTar(Buffer.from("dpf-render: rendering failed"))).toThrow(/not a tar/);
  });
});
