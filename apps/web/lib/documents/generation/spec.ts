// Content specs for template-driven document generation (BI-3A0E5413, slice S6
// of BI-815D40C6).
//
// A coworker (or any caller) describes WHAT a document says; dpf-render lays it
// out inside the engine. The model writes one of these specs, never raw office
// XML, and every spec is validated here before a container is started, so a
// bad spec costs a field-level message instead of an engine run.
//
// Five families, one wire contract with tools/doctools/dpf-render:
//   deck     -> pptx | odp | pdf     (Impress)
//   report   -> docx | odt | pdf     (Writer)
//   letter   -> docx | odt | pdf     (Writer)
//   sheet    -> xlsx | ods | pdf     (Calc)
//   drawing  -> odg  | svg | pdf     (Draw)
// PNG page previews and a plain-text layer come with every render.
//
// Validation composes the platform's existing validator (zod, already a
// dependency). Every limit below is a bound on what one request may ask the
// engine to do; the runtime (render.ts) adds the byte and time bounds.

import { z } from "zod";
import { ok, type ActionFailure, type ActionSuccess } from "@/lib/shared/action-result";

export const DOCUMENT_FAMILY_FORMATS = {
  deck: ["pptx", "odp", "pdf"],
  report: ["docx", "odt", "pdf"],
  letter: ["docx", "odt", "pdf"],
  sheet: ["xlsx", "ods", "pdf"],
  drawing: ["odg", "svg", "pdf"],
} as const;

export type DocumentFamily = keyof typeof DOCUMENT_FAMILY_FORMATS;
export type RenderFormat = (typeof DOCUMENT_FAMILY_FORMATS)[DocumentFamily][number];

export const RENDER_FORMATS: readonly RenderFormat[] = [
  ...new Set(Object.values(DOCUMENT_FAMILY_FORMATS).flat()),
] as RenderFormat[];

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_PREVIEW_PAGES = 20;
export const DEFAULT_PREVIEW_DPI = 48;

const IMAGE_MAGIC: Record<string, (bytes: Buffer) => boolean> = {
  "image/png": (b) => b.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
  "image/jpeg": (b) => b.subarray(0, 3).toString("hex") === "ffd8ff",
  "image/gif": (b) => b.subarray(0, 4).toString("latin1") === "GIF8",
};

// Functions that reach outside the workbook (network, other files, the host)
// or run code. Generated sheets are opened later on people's own machines, so
// a formula that phones home is refused at the source.
const BLOCKED_FORMULA_FUNCTIONS = ["WEBSERVICE", "FILTERXML", "DDE", "HYPERLINK", "INFO", "CALL", "REGISTER", "RTD", "EXEC"];

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;
const FIELD_KEY = /^[a-z][a-z0-9_.-]{0,63}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const colour = z.string().regex(HEX_COLOUR, "expected a #rrggbb colour");

const chartSchema = z
  .object({
    type: z.enum(["bar", "column", "line", "pie", "area"]),
    title: optionalText(200),
    categories: z.array(text(120)).min(1).max(200),
    series: z
      .array(z.object({ name: text(120), values: z.array(z.number()).min(1).max(200) }))
      .min(1)
      .max(12),
  })
  .superRefine((chart, ctx) => {
    chart.series.forEach((series, index) => {
      if (series.values.length !== chart.categories.length) {
        ctx.addIssue({
          code: "custom",
          path: ["series", index, "values"],
          message: `expected ${chart.categories.length} values, one per category; got ${series.values.length}`,
        });
      }
    });
  });

const imageSchema = z
  .object({
    data: z.string().max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4).regex(BASE64, "expected base64 image data"),
    mimeType: z.enum(["image/png", "image/jpeg", "image/gif"]),
    alt: text(300),
  })
  .superRefine((image, ctx) => {
    const bytes = Buffer.from(image.data, "base64");
    if (bytes.length > MAX_IMAGE_BYTES) {
      ctx.addIssue({ code: "custom", path: ["data"], message: `image is larger than ${MAX_IMAGE_BYTES} bytes` });
    } else if (!IMAGE_MAGIC[image.mimeType](bytes)) {
      ctx.addIssue({ code: "custom", path: ["data"], message: `the bytes are not a ${image.mimeType} image` });
    }
  });

const cellSchema = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);

const tableSchema = z
  .object({
    columns: z.array(text(200)).min(1).max(50),
    rows: z.array(z.array(cellSchema).max(50)).max(500),
  })
  .superRefine((table, ctx) => {
    table.rows.forEach((row, index) => {
      if (row.length > table.columns.length) {
        ctx.addIssue({
          code: "custom",
          path: ["rows", index],
          message: `row has ${row.length} cells but the table has ${table.columns.length} columns`,
        });
      }
    });
  });

const fieldsSchema = z
  .record(z.string(), z.string().max(2000))
  .optional()
  .superRefine((fields, ctx) => {
    const keys = Object.keys(fields ?? {});
    if (keys.length > 100) ctx.addIssue({ code: "custom", message: "at most 100 placeholder fields" });
    for (const key of keys) {
      if (!FIELD_KEY.test(key)) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "placeholder names are lower-case letters, digits, '.', '_' or '-', starting with a letter",
        });
      }
    }
  });

const common = {
  title: text(300),
  subject: optionalText(300),
  author: optionalText(200),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, "expected a language tag such as en or en-GB").optional(),
  /** Values for `{{name}}` placeholders in the template. */
  fields: fieldsSchema,
};

const slideBase = { title: text(300), notes: optionalText(4000) };
const slideSchema = z.discriminatedUnion("layout", [
  z.object({ layout: z.literal("title"), ...slideBase, subtitle: optionalText(300) }),
  z.object({ layout: z.literal("section"), ...slideBase, subtitle: optionalText(300) }),
  z.object({ layout: z.literal("bullets"), ...slideBase, bullets: z.array(text(1000)).min(1).max(12) }),
  z.object({ layout: z.literal("chart"), ...slideBase, chart: chartSchema }),
  z.object({ layout: z.literal("image"), ...slideBase, image: imageSchema, caption: optionalText(300) }),
  z.object({ layout: z.literal("table"), ...slideBase, table: tableSchema }),
]);

const deckSchema = z.object({
  family: z.literal("deck"),
  ...common,
  slides: z.array(slideSchema).min(1).max(100),
});

const blockSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("paragraph"), text: text(20_000) }),
  z.object({ kind: z.literal("bullets"), items: z.array(text(2000)).min(1).max(100) }),
  z.object({ kind: z.literal("table"), table: tableSchema, caption: optionalText(300) }),
  z.object({ kind: z.literal("chart"), chart: chartSchema }),
  z.object({ kind: z.literal("image"), image: imageSchema, caption: optionalText(300) }),
  z.object({ kind: z.literal("page-break") }),
]);

const reportSchema = z.object({
  family: z.literal("report"),
  ...common,
  subtitle: optionalText(300),
  sections: z
    .array(
      z.object({
        heading: text(300),
        level: z.number().int().min(1).max(3).default(1),
        blocks: z.array(blockSchema).max(200).default([]),
      }),
    )
    .min(1)
    .max(200),
});

const letterSchema = z.object({
  family: z.literal("letter"),
  ...common,
  sender: z.object({ name: text(200), lines: z.array(text(200)).max(8).default([]) }).optional(),
  recipient: z.object({ name: text(200), lines: z.array(text(200)).max(8).default([]) }),
  date: text(100),
  reference: optionalText(200),
  salutation: text(200),
  paragraphs: z.array(text(20_000)).min(1).max(100),
  closing: text(200),
  signatureName: text(200),
  signatureTitle: optionalText(200),
});

const formulaSchema = z
  .object({ formula: z.string().max(1000).regex(/^=/, "a formula starts with '='") })
  .superRefine((cell, ctx) => {
    const upper = cell.formula.toUpperCase();
    const blocked = BLOCKED_FORMULA_FUNCTIONS.find((name) => new RegExp(`(^|[^A-Z0-9_.])${name}\\s*\\(`).test(upper));
    if (blocked) {
      ctx.addIssue({
        code: "custom",
        path: ["formula"],
        message: `formula calls ${blocked}, which is not allowed in generated sheets`,
      });
    } else if (/:\/\/|'file:|\[/i.test(cell.formula)) {
      ctx.addIssue({ code: "custom", path: ["formula"], message: "formula refers outside this workbook" });
    }
  });

const sheetCellSchema = z.union([cellSchema, formulaSchema]);

const sheetSchema = z.object({
  family: z.literal("sheet"),
  ...common,
  sheets: z
    .array(
      z
        .object({
          name: z.string().trim().min(1).max(31).regex(/^[^[\]*?:/\\']+$/, "sheet names cannot contain []*?:/\\ or '"),
          columns: z.array(text(200)).min(1).max(100),
          rows: z.array(z.array(sheetCellSchema).max(100)).max(10_000),
          columnFormats: z.array(z.enum(["general", "integer", "decimal", "currency", "percent", "date"])).max(100).optional(),
          chart: chartSchema.optional(),
        })
        .superRefine((sheet, ctx) => {
          sheet.rows.forEach((row, index) => {
            if (row.length > sheet.columns.length) {
              ctx.addIssue({
                code: "custom",
                path: ["rows", index],
                message: `row has ${row.length} cells but the sheet has ${sheet.columns.length} columns`,
              });
            }
          });
        }),
    )
    .min(1)
    .max(20),
});

const coordinate = z.number().min(0).max(5000);
const drawingSchema = z.object({
  family: z.literal("drawing"),
  ...common,
  pages: z
    .array(
      z
        .object({
          name: optionalText(100),
          shapes: z
            .array(
              z.object({
                id: z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/, "shape ids are 1-64 letters, digits, '_', '.', ':' or '-'"),
                kind: z.enum(["rect", "rounded-rect", "ellipse", "diamond", "text"]),
                x: coordinate,
                y: coordinate,
                width: z.number().positive().max(5000),
                height: z.number().positive().max(5000),
                label: optionalText(500),
                fill: colour.optional(),
                stroke: colour.optional(),
                textColour: colour.optional(),
              }),
            )
            .max(500),
          connectors: z
            .array(z.object({ from: z.string(), to: z.string(), label: optionalText(200), stroke: colour.optional() }))
            .max(1000)
            .default([]),
        })
        .superRefine((page, ctx) => {
          const seen = new Set<string>();
          page.shapes.forEach((shape, index) => {
            if (seen.has(shape.id)) {
              ctx.addIssue({ code: "custom", path: ["shapes", index, "id"], message: `duplicate shape id ${shape.id}` });
            }
            seen.add(shape.id);
          });
          page.connectors.forEach((connector, index) => {
            for (const end of ["from", "to"] as const) {
              if (!seen.has(connector[end])) {
                ctx.addIssue({
                  code: "custom",
                  path: ["connectors", index, end],
                  message: `no shape with id ${connector[end]} on this page`,
                });
              }
            }
          });
        }),
    )
    .min(1)
    .max(50),
});

export const contentSpecSchema = z.discriminatedUnion("family", [
  deckSchema,
  reportSchema,
  letterSchema,
  sheetSchema,
  drawingSchema,
]);

const renderRequestSchema = z
  .object({
    content: contentSpecSchema,
    formats: z.array(z.enum(RENDER_FORMATS as [RenderFormat, ...RenderFormat[]])).min(1).max(3),
    previews: z
      .object({
        maxPages: z.number().int().min(0).max(100).default(DEFAULT_PREVIEW_PAGES),
        dpi: z.number().int().min(24).max(150).default(DEFAULT_PREVIEW_DPI),
      })
      .default({ maxPages: DEFAULT_PREVIEW_PAGES, dpi: DEFAULT_PREVIEW_DPI }),
  })
  .superRefine((request, ctx) => {
    const allowed: readonly string[] = DOCUMENT_FAMILY_FORMATS[request.content.family];
    request.formats.forEach((format, index) => {
      if (!allowed.includes(format)) {
        ctx.addIssue({
          code: "custom",
          path: ["formats", index],
          message: `${request.content.family} cannot be rendered as ${format}; allowed: ${allowed.join(", ")}`,
        });
      }
    });
    if (new Set(request.formats).size !== request.formats.length) {
      ctx.addIssue({ code: "custom", path: ["formats"], message: "each format may be requested once" });
    }
  });

export type ContentSpec = z.output<typeof contentSpecSchema>;
export type ValidatedRenderRequest = z.output<typeof renderRequestSchema>;
/** What a caller may pass: defaults (previews, levels, connectors) are optional. */
export type RenderRequestInput = z.input<typeof renderRequestSchema>;

export type SpecIssue = { path: string; message: string };
export type SpecValidationResult = ActionSuccess<ValidatedRenderRequest> | (ActionFailure & { issues: SpecIssue[] });

/**
 * Validate a render request. On failure every problem is reported with its
 * dotted field path (`content.slides.2.chart.series.0.values.1`), so a
 * coworker can fix exactly that field and resubmit.
 */
export function validateRenderRequest(input: unknown): SpecValidationResult {
  const parsed = renderRequestSchema.safeParse(input);
  if (parsed.success) return ok(parsed.data);
  const issues = parsed.error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
  const shown = issues.slice(0, 5).map((issue) => `${issue.path || "(request)"}: ${issue.message}`);
  const more = issues.length > shown.length ? `; and ${issues.length - shown.length} more` : "";
  return { ok: false, error: `The document spec is invalid: ${shown.join("; ")}${more}`, issues };
}
