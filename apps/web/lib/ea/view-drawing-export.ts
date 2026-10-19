// EA view drawing export (BI-4C17BF51, slice S8 of BI-815D40C6).
//
// Two callers, one path: the export menu on the EA view downloads one file
// (exportEaViewDrawingFile), and the EA coworker's export_ea_view_drawing tool
// stores the drawing as a managed Document (saveEaViewDrawing). Both build the
// drawing spec with view-drawing.ts and render it with S6's renderDocument, so
// neither keeps its own renderer. ArchiMate exchange export (export_archimate)
// is a different thing and is unchanged.
//
// The --dpf-* token values the drawing needs are resolved here, on the server:
// the organization's branding (BrandingConfig scope "organization", the same
// record the shell layout turns into CSS) overrides the light-mode defaults in
// app/globals.css. A drawing is printed on white, so it takes the light values.

import { prisma } from "@dpf/db";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { isRecord } from "@/lib/shared/coerce";
import { contentFilename } from "@/lib/documents/document-content";
import type { RenderDocumentRequest, RenderResult, RenderedDocument } from "@/lib/documents/generation/render";
import type { SavedRender } from "@/lib/documents/generation/render-store";
import { buildEaViewDrawingSpec, type DrawingTokens, type EaViewForDrawing } from "./view-drawing";

export const EA_DRAWING_FORMATS = ["odg", "svg", "pdf", "png"] as const;
export type EaDrawingFormat = (typeof EA_DRAWING_FORMATS)[number];

/** app/globals.css :root (light) values; a test keeps the two in step. */
export const DEFAULT_DRAWING_TOKENS: DrawingTokens = {
  accent: "#2563eb", // style-drift-allow
  text: "#1a1a2e", // style-drift-allow
};

const PNG_DPI = 150;
const STORED_PREVIEW_DPI = 96;

export type EaDrawingExportDeps = {
  loadView?: (viewId: string) => Promise<EaViewForDrawing | null>;
  loadTokens?: () => Promise<DrawingTokens>;
  render?: (request: RenderDocumentRequest) => Promise<RenderResult>;
  save?: (
    rendered: RenderedDocument,
    target: { organizationId: string; title: string; tags: string[]; actorPrincipalId: string | null },
  ) => Promise<SavedRender>;
  loadOrganizationId?: () => Promise<string>;
};

function hex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : null;
}

/**
 * The drawing's --dpf-* values from a BrandingConfig `tokens` record: the light
 * half of dual tokens, or legacy flat tokens (lib/release/branding.ts reads the
 * same shapes), falling back per value to the globals.css defaults.
 */
export function resolveDrawingTokens(tokens: unknown): DrawingTokens {
  const light = isRecord(tokens) && isRecord(tokens.light) ? tokens.light : tokens;
  const palette = isRecord(light) && isRecord(light.palette) ? light.palette : {};
  return {
    accent: hex(palette.accent) ?? DEFAULT_DRAWING_TOKENS.accent,
    text: hex(palette.text) ?? DEFAULT_DRAWING_TOKENS.text,
  };
}

async function loadTokens(): Promise<DrawingTokens> {
  const branding = await prisma.brandingConfig.findUnique({ where: { scope: "organization" }, select: { tokens: true } });
  return resolveDrawingTokens(branding?.tokens ?? null);
}

async function loadView(viewId: string): Promise<EaViewForDrawing | null> {
  const { getEaView } = await import("@/lib/explore/ea-data");
  return getEaView(viewId);
}

async function render(request: RenderDocumentRequest): Promise<RenderResult> {
  const { renderDocument } = await import("@/lib/documents/generation/render");
  return renderDocument(request);
}

async function save(...args: Parameters<NonNullable<EaDrawingExportDeps["save"]>>): Promise<SavedRender> {
  const { saveRenderedDocument } = await import("@/lib/documents/generation/render-store");
  return saveRenderedDocument(...args);
}

/** The install organization, chosen the way the document store chooses it. */
async function loadOrganizationId(): Promise<string> {
  const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!org) throw new Error("No Organization row exists for document ownership.");
  return org.id;
}

async function renderView(
  viewId: string,
  formats: RenderDocumentRequest["formats"],
  previews: { maxPages: number; dpi: number },
  deps: EaDrawingExportDeps,
): Promise<ActionResult<{ view: EaViewForDrawing; rendered: RenderedDocument; shapeCount: number; connectorCount: number }>> {
  const view = await (deps.loadView ?? loadView)(viewId);
  if (!view) return err(`EA view ${viewId} was not found.`);
  const tokens = await (deps.loadTokens ?? loadTokens)();
  const spec = buildEaViewDrawingSpec(view, tokens);
  if (!spec.ok) return spec;
  const result = await (deps.render ?? render)({ content: spec.data, formats, previews });
  if (!result.ok) return err(`The drawing could not be rendered: ${result.error}`);
  const page = spec.data.pages[0]!;
  return ok({ view, rendered: result.data, shapeCount: page.shapes.length, connectorCount: page.connectors.length });
}

export type EaDrawingFile = { fileName: string; mimeType: string; bytes: Buffer };

/** One file of an EA view: .odg, .svg or .pdf from the engine, or .png as the PDF's first page. */
export async function exportEaViewDrawingFile(
  input: { viewId: string; format: EaDrawingFormat },
  deps: EaDrawingExportDeps = {},
): Promise<ActionResult<EaDrawingFile>> {
  const png = input.format === "png";
  const engineFormat = input.format === "png" ? "pdf" : input.format;
  const outcome = await renderView(
    input.viewId,
    [engineFormat],
    png ? { maxPages: 1, dpi: PNG_DPI } : { maxPages: 0, dpi: 48 },
    deps,
  );
  if (!outcome.ok) return outcome;
  const { view, rendered } = outcome.data;
  const fileName = contentFilename(view.name, input.format);
  if (png) {
    const first = rendered.previews[0];
    if (!first) return err("The engine returned no page preview for the PNG.");
    return ok({ fileName, mimeType: "image/png", bytes: first });
  }
  const file = rendered.files.find((candidate) => candidate.format === input.format);
  if (!file) return err(`The engine returned no .${input.format} file.`);
  return ok({ fileName, mimeType: file.mime, bytes: file.bytes });
}

export type SavedEaViewDrawing = SavedRender & { href: string; title: string; shapeCount: number; connectorCount: number };

/** Render .odg + .svg + .pdf (+ PNG preview) of an EA view and store it as a managed Document. */
export async function saveEaViewDrawing(
  input: { viewId: string; actorPrincipalId?: string | null },
  deps: EaDrawingExportDeps = {},
): Promise<ActionResult<SavedEaViewDrawing>> {
  const outcome = await renderView(input.viewId, ["odg", "svg", "pdf"], { maxPages: 1, dpi: STORED_PREVIEW_DPI }, deps);
  if (!outcome.ok) return outcome;
  const { view, rendered, shapeCount, connectorCount } = outcome.data;
  const organizationId = await (deps.loadOrganizationId ?? loadOrganizationId)();
  const saved = await (deps.save ?? save)(rendered, {
    organizationId,
    title: view.name,
    tags: ["ea-view", `ea-view:${input.viewId}`],
    actorPrincipalId: input.actorPrincipalId ?? null,
  });
  return ok({
    ...saved,
    title: view.name,
    href: `/workspace/documents/${encodeURIComponent(saved.documentId)}`,
    shapeCount,
    connectorCount,
  });
}
