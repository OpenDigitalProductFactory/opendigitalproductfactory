// Flat ODG -> candidate elements and relationships (BI-4C17BF51, slice S8 import).
import { describe, expect, it } from "vitest";
import { parseFlatOdg } from "./parse-flat-odg";

const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" ' +
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:xml="http://www.w3.org/XML/1998/namespace"';

function doc(pages: string, styles = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?><office:document ${NS}><office:automatic-styles>${styles}</office:automatic-styles><office:body><office:drawing>${pages}</office:drawing></office:body></office:document>`;
}

// What LibreOffice's Visio import writes: each shape a group of a polygon and a
// text frame, each connector a bare line (or a group of a line and its label).
const visioBox = (x: number, y: number, label: string) =>
  `<draw:g><draw:polygon svg:width="3.81cm" svg:height="1.905cm" svg:x="${x}cm" svg:y="${y}cm" svg:viewBox="0 0 3811 1906" draw:points="0,1906 3811,1906 3811,0 0,0"><text:p/></draw:polygon>` +
  `<draw:frame svg:width="3.81cm" svg:height="1.905cm" svg:x="${x}cm" svg:y="${y}cm"><draw:text-box><text:p><text:span>${label}</text:span></text:p></draw:text-box></draw:frame></draw:g>`;

const VISIO = doc(
  `<draw:page draw:name="Page-1">` +
    visioBox(3.175, 5.398, "Customer Portal") +
    visioBox(13.335, 5.398, "Order Service") +
    visioBox(13.335, 13.017, "Orders Database") +
    `<draw:g><draw:line svg:x1="6.985cm" svg:y1="6.35cm" svg:x2="13.335cm" svg:y2="6.35cm"><text:p/></draw:line>` +
    `<draw:frame svg:width="6.35cm" svg:height="0.569cm" svg:x="6.985cm" svg:y="6.066cm"><draw:text-box><text:p><text:span>calls</text:span></text:p></draw:text-box></draw:frame></draw:g>` +
    `<draw:line svg:x1="15.24cm" svg:y1="13.017cm" svg:x2="15.24cm" svg:y2="7.302cm"><text:p/></draw:line>` +
    `<draw:line svg:x1="1cm" svg:y1="20cm" svg:x2="2cm" svg:y2="20cm"><text:p/></draw:line>` +
    `<draw:frame svg:width="5cm" svg:height="1cm" svg:x="1cm" svg:y="1cm"><draw:text-box><text:p>Order platform (title)</text:p></draw:text-box></draw:frame>` +
    `</draw:page>`,
);

// What DPF's own drawing export writes (and Draw saves): shapes with ids and
// connectors glued to them.
const GLUED = doc(
  `<draw:page draw:name="Order platform">` +
    `<draw:custom-shape draw:name="ve-00" draw:style-name="gr1" xml:id="id1" draw:id="id1" svg:width="6.8cm" svg:height="3.2cm" svg:x="1cm" svg:y="1cm"><text:p><text:span>Customer</text:span></text:p><draw:enhanced-geometry draw:type="round-rectangle"/></draw:custom-shape>` +
    `<draw:custom-shape draw:name="ve-01" draw:style-name="gr2" xml:id="id2" draw:id="id2" svg:width="6.8cm" svg:height="3.2cm" svg:x="10.6cm" svg:y="1cm"><text:p>Order</text:p><text:p>Service</text:p><draw:enhanced-geometry draw:type="round-rectangle"/></draw:custom-shape>` +
    `<draw:connector svg:x1="99cm" svg:y1="99cm" svg:x2="98cm" svg:y2="98cm" draw:start-shape="id1" draw:end-shape="id2"><text:p>serves</text:p></draw:connector>` +
    `</draw:page><draw:page draw:name="Second"><draw:rect svg:width="2cm" svg:height="1cm" svg:x="0cm" svg:y="0cm"><text:p>Lonely</text:p></draw:rect></draw:page>`,
  `<style:style style:name="gr1" style:family="graphic"><style:graphic-properties draw:fill-color="#ffffcc"/></style:style>` +
    `<style:style style:name="gr2" style:family="graphic"><style:graphic-properties draw:fill-color="#CCE5FF"/></style:style>`,
);

describe("parseFlatOdg", () => {
  it("reads a Visio import's grouped shapes as labelled candidate elements with their boxes", () => {
    const result = parseFlatOdg(VISIO);
    expect(result.pages).toHaveLength(1);
    const [page] = result.pages;
    expect(page!.name).toBe("Page-1");
    expect(page!.elements.map((element) => element.label)).toEqual(["Customer Portal", "Order Service", "Orders Database"]);
    expect(page!.elements[0]!.box).toEqual({ x: 31.75, y: 53.98, width: 38.1, height: 19.05 });
  });

  it("joins an unglued line to the shapes its ends touch, carrying the line's label", () => {
    const [page] = parseFlatOdg(VISIO).pages;
    const byKey = new Map(page!.elements.map((element) => [element.key, element.label]));
    const pairs = page!.relationships.map((relationship) => [byKey.get(relationship.fromKey), byKey.get(relationship.toKey), relationship.label]);
    expect(pairs).toEqual([
      ["Customer Portal", "Order Service", "calls"],
      ["Orders Database", "Order Service", null],
    ]);
  });

  it("counts a connector that touches no shape, and ignores free text", () => {
    const [page] = parseFlatOdg(VISIO).pages;
    expect(page!.unattachedConnectors).toBe(1);
    expect(page!.elements.some((element) => element.label.includes("title"))).toBe(false);
  });

  it("follows glued connectors by shape id, whatever their stored geometry says", () => {
    const [first] = parseFlatOdg(GLUED).pages;
    expect(first!.elements.map((element) => element.label)).toEqual(["Customer", "Order Service"]);
    expect(first!.relationships).toEqual([{ fromKey: first!.elements[0]!.key, toKey: first!.elements[1]!.key, label: "serves" }]);
  });

  it("suggests the ArchiMate layer from a shape's fill when it is one of the canvas's layer colours", () => {
    const [first] = parseFlatOdg(GLUED).pages;
    expect(first!.elements.map((element) => element.suggestedLayer)).toEqual(["business", "application"]);
    const [page] = parseFlatOdg(VISIO).pages;
    expect(page!.elements[0]!.suggestedLayer).toBeNull();
  });

  it("reads every page and keys candidates uniquely across them", () => {
    const result = parseFlatOdg(GLUED);
    expect(result.pages.map((page) => page.name)).toEqual(["Order platform", "Second"]);
    expect(result.pages[1]!.elements.map((element) => element.label)).toEqual(["Lonely"]);
    const keys = result.pages.flatMap((page) => page.elements.map((element) => element.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("refuses something that is not a flat ODF drawing", () => {
    expect(() => parseFlatOdg("<html><body/></html>")).toThrow(/not a flat ODF drawing/);
  });
});
