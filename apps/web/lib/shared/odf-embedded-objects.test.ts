import { describe, expect, it } from "vitest";
import { CHART_OBJECT_PARTS, odfPackage, zipPackage } from "./__fixtures__/odf-package";
import { hasOdfEmbeddedObjects, odfEmbeddedObjects } from "./odf-embedded-objects";

describe("odfEmbeddedObjects", () => {
  it("names the chart sub-document an office suite embeds", () => {
    expect(odfEmbeddedObjects(odfPackage("spreadsheet", CHART_OBJECT_PARTS))).toEqual(["Object 1/"]);
    expect(odfEmbeddedObjects(odfPackage("text", CHART_OBJECT_PARTS, { deflate: false }))).toEqual(["Object 1/"]);
  });

  it("names OLE objects and other embedded documents too", () => {
    const pkg = odfPackage("text", [
      { path: "Object 2", data: "ole", mediaType: "application/vnd.sun.star.oleobject" },
      { path: "Object 3/", data: "", mediaType: "application/vnd.oasis.opendocument.formula" },
    ]);
    expect(odfEmbeddedObjects(pkg)).toEqual(["Object 2", "Object 3/"]);
    expect(hasOdfEmbeddedObjects(pkg)).toBe(true);
  });

  it("finds nothing embedded in a plain package or one with only pictures", () => {
    expect(odfEmbeddedObjects(odfPackage("text"))).toEqual([]);
    const pictures = odfPackage("presentation", [
      { path: "Pictures/logo.png", data: "png", mediaType: "image/png" },
      { path: "Configurations2/", data: "", mediaType: "application/vnd.sun.xml.ui.configuration" },
    ]);
    expect(odfEmbeddedObjects(pictures)).toEqual([]);
    expect(hasOdfEmbeddedObjects(pictures)).toBe(false);
  });

  it("counts the object elements of a flat ODF document", () => {
    const flat = (body: string) =>
      Buffer.from(`<?xml version="1.0"?><office:document office:mimetype="application/vnd.oasis.opendocument.spreadsheet">${body}</office:document>`);
    expect(odfEmbeddedObjects(flat("<draw:frame><draw:object><office:document/></draw:object></draw:frame><draw:object-ole/>"))).toEqual([
      "inline object 1",
      "inline object 2",
    ]);
    expect(odfEmbeddedObjects(flat("<draw:frame><draw:image/></draw:frame>"))).toEqual([]);
  });

  it("answers null when there is no readable manifest, so the converter decides", () => {
    expect(odfEmbeddedObjects(odfPackage("text", CHART_OBJECT_PARTS, { manifest: false }))).toBeNull();
    expect(odfEmbeddedObjects(Buffer.from("not a zip at all"))).toBeNull();
    expect(odfEmbeddedObjects(Buffer.alloc(0))).toBeNull();
    const corrupt = zipPackage([{ name: "META-INF/manifest.xml", data: Buffer.from("x".repeat(100)) }]);
    corrupt.writeUInt32LE(0xdeadbeef, 0);
    expect(odfEmbeddedObjects(corrupt)).toBeNull();
    expect(hasOdfEmbeddedObjects(corrupt)).toBe(false);
  });
});
