// create_report, create_letter, create_sheet, create_drawing (BI-012487AA,
// slice A4): the four render families beside create_presentation, composed into
// the document pack (definitions, handlers and grants are spread there, the
// provider-account-tools.ts pattern) so a family tool is registered once.
//
// Each definition describes the OUTLINE a coworker writes; the mapping onto the
// family's content spec, validation, branding and storage are
// lib/documents/generation/create-family-documents.ts. One handler serves all
// four: they differ only in the library call and the nouns in the message.
//
// Grants are single-sourced in lib/tak/document-tool-grants.ts, which the
// gating map spreads; this module re-exports that slice for the pack.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tool-types";
import type { FamilyDocumentResult } from "@/lib/documents/generation/family-document";
import { DOCUMENT_TOOL_GRANTS } from "@/lib/tak/document-tool-grants";

type FamilyToolName = "create_report" | "create_letter" | "create_sheet" | "create_drawing";
type HandlerContext = { agentId?: string };

const DOCUMENT_ID = {
  type: "string",
  description: "An existing document made with this tool to revise, such as DOC-1234ABCD. Omit to create a new one.",
};
const IMAGE = {
  type: "object",
  description: "{ documentId, alt } for an image stored as a document, or { data (base64), mimeType: image/png|image/jpeg|image/gif, alt }. Alt text is required.",
};
const CHART = {
  type: "object",
  description: "{ type: bar|column|line|pie|area, title?, categories: string[], series: [{ name, values: number[] }] } with one value per category.",
};
const TABLE = { type: "object", description: "{ columns: string[], rows: (string|number|boolean|null)[][] }." };
const REVISE = "To revise, send the whole corrected outline again with the documentId; that saves a new version of the same document. Never edit the file itself.";
const SAVED = "laid out in the organization's brand and saved as a managed document";

const LETTER_PARTY = {
  type: "object",
  properties: { name: { type: "string" }, lines: { type: "array", items: { type: "string" }, description: "Address lines, up to 8." } },
  required: ["name"],
};

const SHEET_TABLE_PROPERTIES = {
  columns: { type: "array", items: { type: "string" }, description: "Column headings." },
  rows: {
    type: "array",
    items: { type: "array" },
    description: "Rows of cells: text, numbers, true/false, null, or { formula: \"=SUM(B2:B9)\" }. Formulas stay inside the workbook.",
  },
  columnFormats: {
    type: "array",
    items: { type: "string", enum: ["general", "integer", "decimal", "currency", "percent", "date"] },
    description: "One number format per column.",
  },
  chart: { ...CHART, description: `A chart under the table: ${CHART.description}` },
};

const SHAPE = {
  type: "object",
  properties: {
    id: { type: "string", description: "Unique on its page; connectors refer to it." },
    label: { type: "string" },
    kind: { type: "string", enum: ["rect", "rounded-rect", "ellipse", "diamond", "text"], description: "Defaults to rect." },
    x: { type: "number", description: "Millimetres from the left. Omit x and y to place shapes on a grid in order." },
    y: { type: "number", description: "Millimetres from the top." },
    width: { type: "number", description: "Millimetres; defaults to 50." },
    height: { type: "number", description: "Millimetres; defaults to 25." },
    fill: { type: "string", description: "#rrggbb; defaults to the brand." },
    stroke: { type: "string", description: "#rrggbb." },
    textColour: { type: "string", description: "#rrggbb." },
  },
  required: ["id"],
};
const CONNECTOR = {
  type: "object",
  properties: { from: { type: "string" }, to: { type: "string" }, label: { type: "string" }, stroke: { type: "string" } },
  required: ["from", "to"],
};

export const DOCUMENT_FAMILY_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "create_report",
    description: `Produce a branded report from an outline: a Word (.docx) file, a PDF and a preview image of each page, ${SAVED}. Sections carry paragraphs, bullets, a table, a chart or an image. ${REVISE}`,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Report title." },
        subtitle: { type: "string" },
        author: { type: "string" },
        audience: { type: "string", description: "Who the report is for." },
        purpose: { type: "string", description: "What the reader should decide or do." },
        summary: { type: "string", description: "Executive summary, set as the opening Summary section." },
        documentId: DOCUMENT_ID,
        sections: {
          type: "array",
          description: "The sections, in order.",
          items: {
            type: "object",
            properties: {
              heading: { type: "string" },
              level: { type: "number", enum: [1, 2, 3], description: "Heading level; defaults to 1." },
              paragraphs: { type: "array", items: { type: "string" } },
              bullets: { type: "array", items: { type: "string" } },
              table: TABLE,
              tableCaption: { type: "string" },
              chart: CHART,
              image: IMAGE,
              caption: { type: "string", description: "Caption under the image." },
              pageBreakBefore: { type: "boolean", description: "Start the section on a new page." },
            },
            required: ["heading"],
          },
        },
      },
      required: ["title", "sections"],
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "create_letter",
    description: `Produce a branded letter: a Word (.docx) file, a PDF and a preview, on the organization's letterhead and saved as a managed document. Date, salutation and closing default to today, "Dear <name>," and "Yours sincerely,". ${REVISE}`,
    inputSchema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "What the letter is about; also its title unless title is given." },
        title: { type: "string" },
        recipient: LETTER_PARTY,
        sender: { ...LETTER_PARTY, description: "Usually omitted: the letterhead carries the organization." },
        date: { type: "string", description: "As it should be printed; defaults to today." },
        reference: { type: "string" },
        salutation: { type: "string" },
        paragraphs: { type: "array", items: { type: "string" }, description: "The body, one entry per paragraph." },
        closing: { type: "string" },
        signatureName: { type: "string" },
        signatureTitle: { type: "string" },
        documentId: DOCUMENT_ID,
      },
      required: ["recipient", "paragraphs", "signatureName"],
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "create_sheet",
    description: `Produce a branded spreadsheet: an Excel (.xlsx) workbook, a PDF and page previews, ${SAVED}. Give one table as columns and rows, or several as sheets; cells may hold formulas. ${REVISE}`,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Workbook title." },
        ...SHEET_TABLE_PROPERTIES,
        sheets: {
          type: "array",
          description: "Several tables, one per sheet, instead of top-level columns and rows.",
          items: {
            type: "object",
            properties: { name: { type: "string", description: "Up to 31 characters; defaults to Sheet1, Sheet2, …" }, ...SHEET_TABLE_PROPERTIES },
            required: ["columns", "rows"],
          },
        },
        documentId: DOCUMENT_ID,
      },
      required: ["title"],
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "create_drawing",
    description: `Produce a branded diagram from boxes and arrows: an OpenDocument drawing (.odg), an SVG, a PDF and a preview of each page, ${SAVED}. Shapes without a position are placed on a grid in order. ${REVISE}`,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Drawing title." },
        shapes: { type: "array", items: SHAPE, description: "A one-page drawing's shapes." },
        connectors: { type: "array", items: CONNECTOR, description: "Arrows between shapes on that page, by shape id." },
        pages: {
          type: "array",
          description: "Several pages instead of top-level shapes and connectors.",
          items: {
            type: "object",
            properties: { name: { type: "string" }, shapes: { type: "array", items: SHAPE }, connectors: { type: "array", items: CONNECTOR } },
            required: ["shapes"],
          },
        },
        documentId: DOCUMENT_ID,
      },
      required: ["title"],
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: true,
  },
];

export const DOCUMENT_FAMILY_TOOL_GRANTS = {
  create_report: DOCUMENT_TOOL_GRANTS.create_report,
  create_letter: DOCUMENT_TOOL_GRANTS.create_letter,
  create_sheet: DOCUMENT_TOOL_GRANTS.create_sheet,
  create_drawing: DOCUMENT_TOOL_GRANTS.create_drawing,
} satisfies Record<FamilyToolName, string[]>;

const NOUNS: Record<FamilyToolName, string> = {
  create_report: "report",
  create_letter: "letter",
  create_sheet: "sheet",
  create_drawing: "drawing",
};

async function runFamilyTool(
  name: FamilyToolName,
  params: Record<string, unknown>,
  userId: string,
  context: HandlerContext | undefined,
  resolveActor: (userId: string, agentId?: string) => Promise<string | null>,
): Promise<ToolResult> {
  const families = await import("@/lib/documents/generation/create-family-documents");
  const create = {
    create_report: families.createReport,
    create_letter: families.createLetter,
    create_sheet: families.createSheet,
    create_drawing: families.createDrawing,
  }[name] as (input: { outline: never; actorPrincipalId: string | null }) => Promise<FamilyDocumentResult>;
  const actorPrincipalId = await resolveActor(userId, context?.agentId);
  const result = await create({ outline: params as never, actorPrincipalId });
  if (!result.ok) {
    return { success: false, message: result.error, error: result.error, data: { reason: result.reason } };
  }
  const created = result.data;
  const verb = created.revised ? "Revised" : "Created";
  const pages = `${created.pageCount} page${created.pageCount === 1 ? "" : "s"}`;
  const warnings = created.warnings.length > 0 ? ` Engine notes: ${created.warnings.join("; ")}.` : "";
  return {
    success: true,
    entityId: created.documentId,
    message:
      `${verb} ${NOUNS[name]} ${created.documentId} v${created.version}: ${pages} as ${created.formats.join(" and ")}, ` +
      `with ${created.previewCount} page previews. Review it at ${created.route}.${warnings}`,
    data: { ...created },
  };
}

/** The four handlers, given the pack's actor resolution so attribution stays one implementation. */
export function documentFamilyToolHandlers(
  resolveActor: (userId: string, agentId?: string) => Promise<string | null>,
): Record<FamilyToolName, (params: Record<string, unknown>, userId: string, context?: HandlerContext) => Promise<ToolResult>> {
  const handler = (name: FamilyToolName) => (params: Record<string, unknown>, userId: string, context?: HandlerContext) =>
    runFamilyTool(name, params, userId, context, resolveActor);
  return {
    create_report: handler("create_report"),
    create_letter: handler("create_letter"),
    create_sheet: handler("create_sheet"),
    create_drawing: handler("create_drawing"),
  };
}
