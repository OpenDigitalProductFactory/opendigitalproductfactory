import { describe, expect, it } from "vitest";
import {
  DOCUMENT_FAMILY_FORMATS,
  validateRenderRequest,
  type RenderRequestInput,
} from "./spec";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function deck(): RenderRequestInput {
  return {
    formats: ["pptx", "pdf"],
    content: {
      family: "deck",
      title: "Spring adoption drive",
      fields: { "org.name": "Second Chance Animal Rescue" },
      slides: [
        { layout: "title", title: "Spring adoption drive", subtitle: "Board update" },
        { layout: "bullets", title: "Where we are", bullets: ["42 adoptions", "12 fosters"] },
        {
          layout: "chart",
          title: "Adoptions by month",
          chart: {
            type: "bar",
            categories: ["Jan", "Feb", "Mar"],
            series: [{ name: "Adoptions", values: [10, 14, 18] }],
          },
        },
        { layout: "image", title: "Meet Biscuit", image: { data: PNG_1X1, mimeType: "image/png", alt: "A dog" } },
        { layout: "table", title: "Costs", table: { columns: ["Item", "Cost"], rows: [["Food", 120], ["Vet", 300]] } },
      ],
    },
  };
}

function issuesOf(input: unknown): Array<{ path: string; message: string }> {
  const result = validateRenderRequest(input);
  if (result.ok) throw new Error("expected the request to be rejected");
  return result.issues;
}

describe("validateRenderRequest", () => {
  it("accepts a deck with title, bullet, chart, image and table slides", () => {
    const result = validateRenderRequest(deck());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.content.family).toBe("deck");
    expect(result.data.formats).toEqual(["pptx", "pdf"]);
    // Defaults are filled so the engine never guesses.
    expect(result.data.previews).toEqual({ maxPages: 20, dpi: 48 });
  });

  it("accepts a report, a letter, a sheet and a drawing", () => {
    const requests: RenderRequestInput[] = [
      {
        formats: ["docx"],
        content: {
          family: "report",
          title: "Quarterly report",
          sections: [
            {
              heading: "Summary",
              blocks: [
                { kind: "paragraph", text: "Adoptions rose." },
                { kind: "bullets", items: ["one", "two"] },
                { kind: "table", table: { columns: ["A"], rows: [["x"]] } },
                { kind: "chart", chart: { type: "line", categories: ["Q1"], series: [{ name: "S", values: [1] }] } },
              ],
            },
          ],
        },
      },
      {
        formats: ["pdf", "odt"],
        content: {
          family: "letter",
          title: "Thank you",
          recipient: { name: "Ada Lovelace", lines: ["1 Main St"] },
          date: "2026-09-25",
          salutation: "Dear Ada,",
          paragraphs: ["Thank you for your gift."],
          closing: "With gratitude,",
          signatureName: "The team",
        },
      },
      {
        formats: ["xlsx", "ods"],
        content: {
          family: "sheet",
          title: "Donations",
          sheets: [
            {
              name: "2026",
              columns: ["Month", "Amount"],
              rows: [["Jan", 100], ["Feb", 200], ["Total", { formula: "=SUM(B2:B3)" }]],
              chart: { type: "pie", categories: ["Jan", "Feb"], series: [{ name: "Amount", values: [100, 200] }] },
            },
          ],
        },
      },
      {
        formats: ["odg", "svg", "pdf"],
        content: {
          family: "drawing",
          title: "Intake flow",
          pages: [
            {
              shapes: [
                { id: "a", kind: "rect", x: 10, y: 10, width: 40, height: 20, label: "Intake" },
                { id: "b", kind: "ellipse", x: 80, y: 10, width: 40, height: 20, label: "Foster", fill: "#aaccee" },
              ],
              connectors: [{ from: "a", to: "b", label: "places" }],
            },
          ],
        },
      },
    ];
    for (const request of requests) {
      const result = validateRenderRequest(request);
      expect(result.ok, JSON.stringify(result.ok ? null : result.issues)).toBe(true);
    }
  });

  it("rejects an unknown family with the field path", () => {
    expect(issuesOf({ formats: ["pdf"], content: { family: "poster", title: "x" } })).toEqual([
      expect.objectContaining({ path: "content.family" }),
    ]);
  });

  it("rejects a format the family cannot produce", () => {
    const request = deck();
    request.formats = ["xlsx"];
    expect(issuesOf(request)).toEqual([
      { path: "formats.0", message: "deck cannot be rendered as xlsx; allowed: pptx, odp, pdf" },
    ]);
  });

  it("names the exact slide and value that is wrong", () => {
    const request = deck() as { content: { slides: Array<Record<string, unknown>> } } & RenderRequestInput;
    request.content.slides[2] = {
      layout: "chart",
      title: "Broken",
      chart: { type: "bar", categories: ["Jan", "Feb"], series: [{ name: "S", values: [1, Number.NaN] }] },
    };
    const paths = issuesOf(request).map((issue) => issue.path);
    expect(paths).toContain("content.slides.2.chart.series.0.values.1");
  });

  it("rejects a chart whose series length does not match its categories", () => {
    const request = deck() as { content: { slides: Array<Record<string, unknown>> } } & RenderRequestInput;
    request.content.slides[2] = {
      layout: "chart",
      title: "Short",
      chart: { type: "bar", categories: ["Jan", "Feb"], series: [{ name: "S", values: [1] }] },
    };
    expect(issuesOf(request)).toContainEqual({
      path: "content.slides.2.chart.series.0.values",
      message: "expected 2 values, one per category; got 1",
    });
  });

  it("requires the payload each deck layout depends on", () => {
    const request = deck() as { content: { slides: Array<Record<string, unknown>> } } & RenderRequestInput;
    request.content.slides[3] = { layout: "image", title: "No image" };
    expect(issuesOf(request).map((issue) => issue.path)).toContain("content.slides.3.image");
  });

  it("refuses an image that is not the base64 of the declared type", () => {
    const request = deck() as { content: { slides: Array<Record<string, unknown>> } } & RenderRequestInput;
    request.content.slides[3] = {
      layout: "image",
      title: "Fake",
      image: { data: Buffer.from("<svg onload=x>").toString("base64"), mimeType: "image/png", alt: "x" },
    };
    expect(issuesOf(request)).toContainEqual({
      path: "content.slides.3.image.data",
      message: "the bytes are not a image/png image",
    });
  });

  it("refuses a table row wider than its columns", () => {
    const request = deck() as { content: { slides: Array<Record<string, unknown>> } } & RenderRequestInput;
    request.content.slides[4] = { layout: "table", title: "T", table: { columns: ["A"], rows: [["x", "y"]] } };
    expect(issuesOf(request)).toContainEqual({
      path: "content.slides.4.table.rows.0",
      message: "row has 2 cells but the table has 1 columns",
    });
  });

  it("refuses a drawing connector that points at no shape, and duplicate shape ids", () => {
    const paths = issuesOf({
      formats: ["odg"],
      content: {
        family: "drawing",
        title: "d",
        pages: [
          {
            shapes: [
              { id: "a", kind: "rect", x: 0, y: 0, width: 10, height: 10, label: "A" },
              { id: "a", kind: "rect", x: 20, y: 0, width: 10, height: 10, label: "A2" },
            ],
            connectors: [{ from: "a", to: "zzz" }],
          },
        ],
      },
    }).map((issue) => issue.path);
    expect(paths).toEqual(expect.arrayContaining(["content.pages.0.shapes.1.id", "content.pages.0.connectors.0.to"]));
  });

  it("refuses spreadsheet formulas that reach outside the workbook", () => {
    const issues = issuesOf({
      formats: ["xlsx"],
      content: {
        family: "sheet",
        title: "s",
        sheets: [{ name: "S", columns: ["A"], rows: [[{ formula: '=WEBSERVICE("http://x")' }]] }],
      },
    });
    expect(issues).toContainEqual({
      path: "content.sheets.0.rows.0.0.formula",
      message: "formula calls WEBSERVICE, which is not allowed in generated sheets",
    });
  });

  it("refuses a placeholder key that is not a plain name", () => {
    const request = deck();
    (request.content as { fields: Record<string, string> }).fields = { "bad key}}": "x" };
    expect(issuesOf(request).map((issue) => issue.path)).toContain("content.fields.bad key}}");
  });

  it("refuses an empty format list and a missing content", () => {
    expect(issuesOf({ formats: [] }).map((issue) => issue.path)).toEqual(
      expect.arrayContaining(["formats", "content"]),
    );
  });
});

describe("DOCUMENT_FAMILY_FORMATS", () => {
  it("lists every family and only formats dpf-render exports", () => {
    expect(Object.keys(DOCUMENT_FAMILY_FORMATS).sort()).toEqual(["deck", "drawing", "letter", "report", "sheet"]);
    expect(DOCUMENT_FAMILY_FORMATS.drawing).toEqual(["odg", "svg", "pdf"]);
  });
});
