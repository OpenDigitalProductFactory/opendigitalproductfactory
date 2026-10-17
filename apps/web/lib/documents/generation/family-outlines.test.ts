import { describe, expect, it } from "vitest";
import {
  drawingOutlineIssues,
  letterOutlineIssues,
  outlineToDrawingSpec,
  outlineToLetterSpec,
  outlineToReportSpec,
  outlineToSheetSpec,
  reportOutlineIssues,
  sheetOutlineIssues,
  type DrawingOutline,
  type LetterOutline,
  type ReportOutline,
  type SheetOutline,
} from "./family-outlines";
import { validateRenderRequest } from "./spec";

const NOW = new Date("2026-10-14T12:00:00Z");

function quarterlyReport(overrides: Partial<ReportOutline> = {}): ReportOutline {
  return {
    title: "Third quarter operations",
    subtitle: "For the board",
    author: "Finance",
    audience: "Board",
    purpose: "Decide the winter budget",
    summary: "Adoptions rose 20%; costs held flat.",
    sections: [
      { heading: "Adoptions", paragraphs: ["We placed 42 animals.", "Fosters carried the peak."], bullets: ["Dogs 30", "Cats 12"] },
      {
        heading: "By month",
        level: 2,
        chart: { type: "column", categories: ["Jul", "Aug", "Sep"], series: [{ name: "Adoptions", values: [12, 14, 16] }] },
        table: { columns: ["Month", "Adoptions"], rows: [["Jul", 12], ["Aug", 14], ["Sep", 16]] },
        tableCaption: "Adoptions per month",
      },
      { heading: "Appendix", pageBreakBefore: true, blocks: [{ kind: "paragraph", text: "Method notes." }] },
    ],
    ...overrides,
  };
}

describe("outlineToReportSpec", () => {
  it("maps each outline section to one report section, its content to blocks in reading order", () => {
    const spec = outlineToReportSpec(quarterlyReport());
    expect(spec).toMatchObject({ family: "report", title: "Third quarter operations", subtitle: "For the board", author: "Finance" });
    expect(spec.subject).toBe("Decide the winter budget");
    expect(spec.fields).toEqual({ audience: "Board", purpose: "Decide the winter budget" });
    expect(spec.sections.map((section) => section.heading)).toEqual(["Summary", "Adoptions", "By month", "Appendix"]);
    expect(spec.sections[0]!.blocks).toEqual([{ kind: "paragraph", text: "Adoptions rose 20%; costs held flat." }]);
    expect(spec.sections[1]!.blocks!.map((block) => block.kind)).toEqual(["paragraph", "paragraph", "bullets"]);
    expect(spec.sections[2]).toMatchObject({ level: 2 });
    expect(spec.sections[2]!.blocks!.map((block) => block.kind)).toEqual(["table", "chart"]);
    expect(spec.sections[2]!.blocks![0]).toMatchObject({ caption: "Adoptions per month" });
  });

  it("keeps explicit blocks as written and starts a section on a new page when asked", () => {
    const spec = outlineToReportSpec(quarterlyReport());
    expect(spec.sections[3]!.blocks).toEqual([{ kind: "page-break" }, { kind: "paragraph", text: "Method notes." }]);
  });

  it("produces a spec the render request validator accepts", () => {
    const content = outlineToReportSpec(quarterlyReport());
    expect(validateRenderRequest({ content, formats: ["docx", "pdf"] }).ok).toBe(true);
  });

  it("names the field to fix when the outline is not shaped like a report", () => {
    expect(reportOutlineIssues({ title: "", sections: [] } as unknown as ReportOutline)).toEqual([
      "title: a report needs a title",
      "sections: a report needs at least one section",
    ]);
    expect(reportOutlineIssues({ title: "x", sections: ["oops"] } as unknown as ReportOutline)).toEqual([
      "sections.0: expected an object with a heading",
    ]);
  });
});

function thankYouLetter(overrides: Partial<LetterOutline> = {}): LetterOutline {
  return {
    subject: "Your gift",
    recipient: { name: "Ada Lovelace", lines: ["12 Analytical Way", "London"] },
    paragraphs: ["Thank you for your generous gift.", "It paid for a month of vet care."],
    signatureName: "Grace Hopper",
    signatureTitle: "Director",
    ...overrides,
  };
}

describe("outlineToLetterSpec", () => {
  it("fills a dated, addressed letter with a conventional salutation and closing when the outline leaves them out", () => {
    const spec = outlineToLetterSpec(thankYouLetter(), NOW, "en-GB");
    expect(spec).toMatchObject({
      family: "letter",
      title: "Your gift",
      subject: "Your gift",
      recipient: { name: "Ada Lovelace", lines: ["12 Analytical Way", "London"] },
      date: "14 October 2026",
      salutation: "Dear Ada Lovelace,",
      closing: "Yours sincerely,",
      signatureName: "Grace Hopper",
      signatureTitle: "Director",
    });
    expect(validateRenderRequest({ content: spec, formats: ["docx", "pdf"] }).ok).toBe(true);
  });

  it("keeps the writer's own title, date, salutation, closing and sender", () => {
    const spec = outlineToLetterSpec(
      thankYouLetter({
        title: "Thank-you letter",
        date: "1 November 2026",
        salutation: "Dear Ada,",
        closing: "With gratitude,",
        sender: { name: "Second Chance Animal Rescue", lines: ["1 Shelter Road"] },
        reference: "GIFT-42",
      }),
      NOW,
      "en-GB",
    );
    expect(spec).toMatchObject({
      title: "Thank-you letter",
      date: "1 November 2026",
      salutation: "Dear Ada,",
      closing: "With gratitude,",
      sender: { name: "Second Chance Animal Rescue", lines: ["1 Shelter Road"] },
      reference: "GIFT-42",
    });
  });

  it("titles a letter with no subject after its recipient", () => {
    expect(outlineToLetterSpec(thankYouLetter({ subject: undefined }), NOW, "en-GB").title).toBe("Letter to Ada Lovelace");
  });

  it("writes the date in the organization's locale unless the letter names its own language", () => {
    expect(outlineToLetterSpec(thankYouLetter(), NOW, "en-US").date).toBe("October 14, 2026");
    const french = outlineToLetterSpec(thankYouLetter({ language: "fr" }), NOW, "en-US");
    expect(french).toMatchObject({ date: "14 octobre 2026", language: "fr" });
  });

  it("names the field to fix when the outline is not shaped like a letter", () => {
    expect(letterOutlineIssues({ paragraphs: [] } as unknown as LetterOutline)).toEqual([
      "recipient: a letter needs a recipient with a name",
      "paragraphs: a letter needs at least one paragraph",
      "signatureName: a letter needs the name it is signed with",
    ]);
  });
});

describe("outlineToSheetSpec", () => {
  it("maps each outline sheet to a spec sheet, naming unnamed sheets in order", () => {
    const outline: SheetOutline = {
      title: "Donations 2026",
      sheets: [
        {
          name: "By month",
          columns: ["Month", "Amount"],
          columnFormats: ["general", "currency"],
          rows: [["Jan", 100], ["Feb", 300], ["Total", { formula: "=SUM(B2:B3)" }]],
          chart: { type: "pie", categories: ["Jan", "Feb"], series: [{ name: "Amount", values: [100, 300] }] },
        },
        { columns: ["Donor"], rows: [["Ada"]] },
      ],
    };
    const spec = outlineToSheetSpec(outline);
    expect(spec.sheets.map((sheet) => sheet.name)).toEqual(["By month", "Sheet2"]);
    expect(spec.sheets[0]).toMatchObject({ columnFormats: ["general", "currency"], chart: { type: "pie" } });
    expect(validateRenderRequest({ content: spec, formats: ["xlsx", "pdf"] }).ok).toBe(true);
  });

  it("accepts a single table written at the top level as a one-sheet workbook", () => {
    const spec = outlineToSheetSpec({ title: "Donors", columns: ["Donor", "Amount"], rows: [["Ada", 50]] });
    expect(spec.sheets).toEqual([{ name: "Sheet1", columns: ["Donor", "Amount"], rows: [["Ada", 50]] }]);
  });

  it("names the field to fix when the outline is not shaped like a sheet", () => {
    expect(sheetOutlineIssues({ title: "x" } as SheetOutline)).toEqual([
      "sheets: a sheet needs at least one table (sheets, or columns and rows)",
    ]);
  });
});

describe("outlineToDrawingSpec", () => {
  it("lays out shapes without positions on a grid, left to right, so a coworker can draw by naming boxes and arrows", () => {
    const outline: DrawingOutline = {
      title: "Intake flow",
      shapes: [{ id: "intake", label: "Intake" }, { id: "vet", label: "Vet check", kind: "diamond" }, { id: "foster", label: "Foster" }],
      connectors: [{ from: "intake", to: "vet" }, { from: "vet", to: "foster", label: "healthy" }],
    };
    const spec = outlineToDrawingSpec(outline);
    expect(spec.pages).toHaveLength(1);
    const shapes = spec.pages[0]!.shapes;
    expect(shapes.map((shape) => shape.kind)).toEqual(["rect", "diamond", "rect"]);
    expect(shapes.map((shape) => [shape.x, shape.y])).toEqual([[20, 30], [95, 30], [170, 30]]);
    expect(shapes.every((shape) => shape.width === 50 && shape.height === 25)).toBe(true);
    expect(spec.pages[0]!.connectors).toEqual(outline.connectors);
    expect(validateRenderRequest({ content: spec, formats: ["odg", "pdf"] }).ok).toBe(true);
  });

  it("wraps the grid after four shapes and keeps positions the coworker gave", () => {
    const shapes = Array.from({ length: 5 }, (_, index) => ({ id: `s${index}` }));
    const spec = outlineToDrawingSpec({ title: "Grid", pages: [{ shapes: [...shapes, { id: "fixed", x: 5, y: 6, width: 10, height: 12 }] }] });
    const placed = spec.pages[0]!.shapes;
    expect([placed[4]!.x, placed[4]!.y]).toEqual([20, 75]);
    expect(placed[5]).toMatchObject({ x: 5, y: 6, width: 10, height: 12 });
  });

  it("names the field to fix when the outline is not shaped like a drawing", () => {
    expect(drawingOutlineIssues({ title: "x", pages: [{ shapes: "nope" }] } as unknown as DrawingOutline)).toEqual([
      "pages.0.shapes: expected a list of shapes",
    ]);
    expect(drawingOutlineIssues({ title: "x" } as DrawingOutline)).toEqual([
      "pages: a drawing needs at least one page (pages, or shapes)",
    ]);
  });
});
