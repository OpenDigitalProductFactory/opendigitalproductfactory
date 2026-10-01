// Customer diagrams into EA review (BI-4C17BF51, slice S8 of BI-815D40C6, import half).
//
// A Visio (.vsd, .vsdx) or Draw (.odg) file goes through the document engine
// twice: to flat ODF XML, which parse-flat-odg.ts reads for shape and connector
// text, and to SVG, the picture a reviewer looks at. What comes out is staged as
// EA review proposals (EaReferenceProposal, the EA proposal queue's table),
// never as model elements:
//   diagram_import                one row per file: name, digest, stored blobs, counts
//   diagram_import_element        one row per labelled shape
//   diagram_import_relationship   one row per connector that joins two shapes
// A reviewer accepts or rejects each candidate with the existing
// reviewReferenceProposal action. Nothing here writes EaElement or
// EaRelationship; adding accepted candidates to the model is a separate step.

import { createHash } from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import type { ConversionResult, ConvertRequest } from "@/lib/documents/conversion/convert";
import { parseFlatOdg, type ParsedDrawing } from "./parse-flat-odg";

export const DIAGRAM_IMPORT_KIND = {
  import: "diagram_import",
  element: "diagram_import_element",
  relationship: "diagram_import_relationship",
} as const;

export const DIAGRAM_IMPORT_EXTENSIONS = ["vsd", "vsdx", "odg"] as const;
/**
 * The upload travels in a server action, whose request body Next.js caps at
 * 1 MB; this leaves room for the form encoding. Diagram files are usually far
 * smaller. A larger file is refused with this limit named, never cut off.
 */
export const MAX_DIAGRAM_IMPORT_BYTES = 900 * 1024;
export const MAX_DIAGRAM_IMPORT_LABEL = `${MAX_DIAGRAM_IMPORT_BYTES / 1024} KB`;

export type StagedDiagramImport = {
  fileName: string;
  sha256: string;
  bytes: Buffer;
  svg: Buffer | null;
  drawing: ParsedDrawing;
  userId: string | null;
};

export type DiagramImportDeps = {
  convert?: (request: ConvertRequest) => Promise<ConversionResult>;
  /** The import row already staged for these exact bytes, if any. */
  findExisting?: (sha256: string) => Promise<string | null>;
  /** Writes the import and its candidates; returns the import row's id. */
  stage?: (input: StagedDiagramImport) => Promise<string>;
};

export type DiagramImportSummary = {
  importId: string;
  alreadyImported: boolean;
  elementCount: number;
  relationshipCount: number;
  unattachedConnectors: number;
  pageCount: number;
  truncated: boolean;
  previewAvailable: boolean;
};

async function convert(request: ConvertRequest): Promise<ConversionResult> {
  const { convertDocument } = await import("@/lib/documents/conversion/convert");
  return convertDocument(request);
}

async function findExisting(sha256: string): Promise<string | null> {
  const row = await prisma.eaReferenceProposal.findFirst({
    where: { proposalType: DIAGRAM_IMPORT_KIND.import, payload: { path: ["sha256"], equals: sha256 } },
    select: { id: true },
  });
  return row?.id ?? null;
}

async function stage(input: StagedDiagramImport): Promise<string> {
  const { storeDocumentBlob } = await import("@/lib/documents/blob-storage");
  const source = await storeDocumentBlob({ content: input.bytes, mimeType: null });
  const svg = input.svg ? await storeDocumentBlob({ content: input.svg, mimeType: "image/svg+xml" }) : null;
  const pages = input.drawing.pages;
  const proposedBy = { proposedByType: "user", proposedByRef: input.userId };
  return prisma.$transaction(async (tx) => {
    const header = await tx.eaReferenceProposal.create({
      data: {
        proposalType: DIAGRAM_IMPORT_KIND.import,
        ...proposedBy,
        payload: {
          fileName: input.fileName,
          sha256: input.sha256,
          sourceBlob: { id: source.id, sha256: source.sha256, storageKey: source.storageKey },
          svgBlob: svg ? { id: svg.id, sha256: svg.sha256, storageKey: svg.storageKey } : null,
          pages: pages.map((page) => ({ name: page.name, unattachedConnectors: page.unattachedConnectors })),
          truncated: input.drawing.truncated,
        } satisfies Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    const labels = new Map(pages.flatMap((page) => page.elements.map((element) => [element.key, element.label] as const)));
    const rows: Prisma.EaReferenceProposalCreateManyInput[] = pages.flatMap((page) => [
      ...page.elements.map((element) => ({
        proposalType: DIAGRAM_IMPORT_KIND.element,
        ...proposedBy,
        payload: { importId: header.id, page: page.name, ...element } satisfies Prisma.InputJsonValue,
      })),
      ...page.relationships.map((relationship) => ({
        proposalType: DIAGRAM_IMPORT_KIND.relationship,
        ...proposedBy,
        payload: {
          importId: header.id,
          page: page.name,
          ...relationship,
          fromLabel: labels.get(relationship.fromKey) ?? null,
          toLabel: labels.get(relationship.toKey) ?? null,
        } satisfies Prisma.InputJsonValue,
      })),
    ]);
    if (rows.length > 0) await tx.eaReferenceProposal.createMany({ data: rows });
    return header.id;
  });
}

function extensionOf(fileName: string): string {
  return fileName.trim().toLowerCase().split(".").pop() ?? "";
}

/** Convert, parse and stage one diagram file as EA review proposals. Never throws for an expected refusal. */
export async function importDiagramFile(
  input: { fileName: string; bytes: Buffer; userId: string | null },
  deps: DiagramImportDeps = {},
): Promise<ActionResult<DiagramImportSummary>> {
  const from = extensionOf(input.fileName);
  if (!(DIAGRAM_IMPORT_EXTENSIONS as readonly string[]).includes(from)) {
    return err("Choose a Visio (.vsd, .vsdx) or Draw (.odg) file.");
  }
  if (input.bytes.length === 0) return err("The file is empty.");
  if (input.bytes.length > MAX_DIAGRAM_IMPORT_BYTES) {
    return err(`The file is larger than ${MAX_DIAGRAM_IMPORT_LABEL}.`);
  }

  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const existing = await (deps.findExisting ?? findExisting)(sha256);
  if (existing) {
    return ok({ importId: existing, alreadyImported: true, elementCount: 0, relationshipCount: 0, unattachedConnectors: 0, pageCount: 0, truncated: false, previewAvailable: false });
  }

  const run = deps.convert ?? convert;
  const flat = await run({ input: input.bytes, from, to: "fodg" });
  if (!flat.ok) {
    return err(
      flat.reason === "converter-unavailable"
        ? "Diagram import needs the document engine, which is not set up on this install."
        : `The diagram could not be read: ${flat.error}`,
    );
  }
  let drawing: ParsedDrawing;
  try {
    drawing = parseFlatOdg(flat.data.bytes.toString("utf8"));
  } catch (error) {
    return err(`The diagram could not be read: ${getErrorMessage(error)}`);
  }
  const elementCount = drawing.pages.reduce((sum, page) => sum + page.elements.length, 0);
  if (elementCount === 0) return err("No labelled shapes were found in this diagram.");

  // The picture is for the reviewer; the candidates stand without it.
  const picture = await run({ input: input.bytes, from, to: "svg" });
  const svg = picture.ok ? picture.data.bytes : null;

  const importId = await (deps.stage ?? stage)({ fileName: input.fileName, sha256, bytes: input.bytes, svg, drawing, userId: input.userId });
  return ok({
    importId,
    alreadyImported: false,
    elementCount,
    relationshipCount: drawing.pages.reduce((sum, page) => sum + page.relationships.length, 0),
    unattachedConnectors: drawing.pages.reduce((sum, page) => sum + page.unattachedConnectors, 0),
    pageCount: drawing.pages.length,
    truncated: drawing.truncated,
    previewAvailable: svg !== null,
  });
}
