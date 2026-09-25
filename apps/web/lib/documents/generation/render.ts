// renderDocument(): template-driven generation on the dpf-doctools engine
// (BI-3A0E5413, slice S6 of BI-815D40C6).
//
// A caller passes a content spec (spec.ts), the formats it wants and a template
// reference. The spec is validated first; only a valid spec starts a container.
// The engine runs one-shot on the S2 runtime with the same containment as
// dpf-convert (conversion/command.ts hardenedRunArgs), shares its concurrency
// cap, and gets a larger time budget, because rendering starts the engine,
// builds a document and exports several formats plus previews.
//
// The result is the office files, the PNG page previews, the PDF text layer and
// the page count. Storing them as a Document is render-store.ts. Expected
// failures come back typed; this never throws for them.

import { randomBytes } from "node:crypto";
import {
  runProcessWithBudget,
  type BudgetedProcessOptions,
  type BudgetedProcessResult,
} from "@/lib/shared/run-process-with-budget";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { ok, type ActionFailure, type ActionSuccess } from "@/lib/shared/action-result";
import { CONVERTER_CONTAINER_PREFIX, hardenedRunArgs, isPinnedImageReference } from "@/lib/documents/conversion/command";
import { sharedDoctoolsLimiter, type ConversionLimiter } from "@/lib/documents/conversion/convert";
import { CONVERTER_TARGET_MIME } from "@/lib/documents/conversion/formats";
import { resolveDoctoolsImage, type DoctoolsImageResolution } from "@/lib/documents/conversion/image";
import { readTar } from "./tar";
import {
  validateRenderRequest,
  type DocumentFamily,
  type RenderFormat,
  type RenderRequestInput,
  type SpecIssue,
} from "./spec";

export const RENDERER_ENTRYPOINT = "/usr/local/bin/dpf-render";
export const DEFAULT_RENDER_TIMEOUT_MS = 240_000;
/** A request carries images inline as base64; dpf-render's own cap (DPF_RENDER_MAX_BYTES). */
export const DEFAULT_MAX_REQUEST_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_RENDER_OUTPUT_BYTES = 300 * 1024 * 1024;

/** Office MIME types come from the converter's table, their one home. */
export const RENDER_FORMAT_MIME: Record<RenderFormat, string> = {
  pptx: CONVERTER_TARGET_MIME.pptx,
  odp: CONVERTER_TARGET_MIME.odp,
  docx: CONVERTER_TARGET_MIME.docx,
  odt: CONVERTER_TARGET_MIME.odt,
  xlsx: CONVERTER_TARGET_MIME.xlsx,
  ods: CONVERTER_TARGET_MIME.ods,
  pdf: CONVERTER_TARGET_MIME.pdf,
  odg: CONVERTER_TARGET_MIME.odg,
  svg: CONVERTER_TARGET_MIME.svg,
};

export type TemplateRef = { kind: "builtin" } | { kind: "brand-master"; organizationId: string };

/** Brand colours dpf-render applies where a template cannot carry them (charts, shapes). */
export type RenderTheme = { chartColours?: string[]; shapeFill?: string; shapeStroke?: string; shapeText?: string };

export type ResolvedTemplate = { ext: "fodp" | "fodt" | "fods" | "fodg"; xml: string; theme?: RenderTheme };

export type RenderDocumentRequest = RenderRequestInput & { templateRef?: TemplateRef };

export type RenderedFile = { format: RenderFormat; bytes: Buffer; mime: string };
export type RenderedDocument = {
  family: DocumentFamily;
  title: string;
  files: RenderedFile[];
  previews: Buffer[];
  text: string;
  pageCount: number;
  warnings: string[];
};

export type RenderFailureReason = "invalid-spec" | "converter-unavailable" | "input-too-large" | "timeout" | "render-failed";
export type RenderFailure = ActionFailure & { reason: RenderFailureReason; issues?: SpecIssue[] };
export type RenderResult = ActionSuccess<RenderedDocument> | RenderFailure;

export type RenderDeps = {
  run?: (command: string, args: string[], opts: BudgetedProcessOptions) => Promise<BudgetedProcessResult>;
  resolveImage?: () => Promise<DoctoolsImageResolution>;
  /** Loads a template reference; the default builds or reuses the organization's brand master. */
  resolveTemplate?: (ref: TemplateRef, family: DocumentFamily) => Promise<ResolvedTemplate | null>;
  limiter?: ConversionLimiter;
  newId?: () => string;
  now?: () => Date;
  timeoutMs?: number;
  maxRequestBytes?: number;
  maxOutputBytes?: number;
};

const fail = (reason: RenderFailureReason, error: string, issues?: SpecIssue[]): RenderFailure =>
  issues ? { ok: false, error, reason, issues } : { ok: false, error, reason };

function lastLines(text: string, count = 3): string {
  return text.trim().split(/\r?\n/).slice(-count).join(" | ");
}

/** The one-shot `docker run` for dpf-render: dpf-convert's containment, dpf-render's entry point. */
export function buildRendererCommand(params: {
  image: string;
  containerName: string;
  maxRequestBytes: number;
  engineTimeoutSeconds: number;
}): { command: string; args: string[] } {
  if (!isPinnedImageReference(params.image)) {
    throw new Error(`renderer image must be pinned by digest (name@sha256:…): ${params.image || "<empty>"}`);
  }
  return {
    command: "docker",
    args: [
      ...hardenedRunArgs(params.containerName),
      "-e",
      `DPF_RENDER_MAX_BYTES=${params.maxRequestBytes}`,
      "-e",
      `DPF_RENDER_TIMEOUT_SECONDS=${params.engineTimeoutSeconds}`,
      "--entrypoint",
      RENDERER_ENTRYPOINT,
      params.image,
    ],
  };
}

async function defaultResolveTemplate(ref: TemplateRef, family: DocumentFamily): Promise<ResolvedTemplate | null> {
  if (ref.kind === "builtin") return null;
  const { loadBrandMasterTemplate } = await import("./brand-master");
  return loadBrandMasterTemplate({ organizationId: ref.organizationId, family });
}

/** dpf-render's contract: 0 ok, 2 bad request, 3 failed, 4 too large or empty, 124 timed out. */
function interpretExit(result: BudgetedProcessResult): RenderFailure | null {
  const detail = `exit ${result.exitCode}: ${lastLines(result.stderr) || "no diagnostics"}`;
  if (result.outputLimitExceeded) return fail("render-failed", `the rendered output exceeded the limit; ${detail}`);
  switch (result.exitCode) {
    case 0:
      return null;
    case 4:
      return fail("input-too-large", detail);
    case 124:
      return fail("timeout", detail);
    case 125:
    case 126:
    case 127:
      return fail("converter-unavailable", detail);
    default:
      // Exit 2 means the engine refused a request this module had already
      // validated: a contract drift between spec.ts and dpf-render, not a user error.
      return fail("render-failed", detail);
  }
}

function unpack(archive: Buffer, family: DocumentFamily, title: string, formats: RenderFormat[]): RenderResult {
  let entries;
  try {
    entries = new Map(readTar(archive).map((entry) => [entry.name, entry.data]));
  } catch (err) {
    return fail("render-failed", `the engine's output is unreadable: ${getErrorMessage(err)}`);
  }
  const missing = formats.map((format) => `document.${format}`).filter((name) => !entries.get(name)?.length);
  if (missing.length > 0) return fail("render-failed", `the engine did not return ${missing.join(", ")}`);
  let manifest: { pageCount?: unknown; warnings?: unknown };
  try {
    manifest = JSON.parse(entries.get("manifest.json")?.toString("utf8") ?? "");
  } catch {
    return fail("render-failed", "the engine returned no readable manifest.json");
  }
  const previews = [...entries.keys()]
    .filter((name) => /^preview-\d{3}\.png$/.test(name))
    .sort()
    .map((name) => entries.get(name)!);
  return ok({
    family,
    title,
    files: formats.map((format) => ({ format, bytes: entries.get(`document.${format}`)!, mime: RENDER_FORMAT_MIME[format] })),
    previews,
    text: entries.get("text.txt")?.toString("utf8") ?? "",
    pageCount: typeof manifest.pageCount === "number" ? manifest.pageCount : previews.length,
    warnings: Array.isArray(manifest.warnings) ? manifest.warnings.map(String) : [],
  });
}

export async function renderDocument(request: RenderDocumentRequest, deps: RenderDeps = {}): Promise<RenderResult> {
  const { templateRef, ...spec } = request;
  const validated = validateRenderRequest(spec);
  if (!validated.ok) return fail("invalid-spec", validated.error, validated.issues);
  const { content, formats, previews } = validated.data;

  const timeoutMs = deps.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  const maxRequestBytes = deps.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;

  let template: ResolvedTemplate | null = null;
  if (templateRef && templateRef.kind !== "builtin") {
    try {
      template = await (deps.resolveTemplate ?? defaultResolveTemplate)(templateRef, content.family);
    } catch (err) {
      return fail("render-failed", `the ${templateRef.kind} template could not be prepared: ${getErrorMessage(err)}`);
    }
  }

  const wire = Buffer.from(
    JSON.stringify({
      template: template ? { ext: template.ext, data: Buffer.from(template.xml, "utf8").toString("base64") } : null,
      content,
      formats,
      previews,
      theme: template?.theme ?? null,
      issuedAt: (deps.now ?? (() => new Date()))().toISOString(),
    }),
    "utf8",
  );
  if (wire.length > maxRequestBytes) {
    return fail("input-too-large", `the render request is ${wire.length} bytes; the limit is ${maxRequestBytes}`);
  }

  const resolution = await (deps.resolveImage ?? resolveDoctoolsImage)();
  if (resolution.status === "not-configured") {
    return fail("converter-unavailable", "no dpf-doctools image is configured (self_upgrade.doctoolsImage or DPF_DOCTOOLS_IMAGE)");
  }
  if (resolution.status === "unpinned") {
    return fail("converter-unavailable", `the configured dpf-doctools image is not pinned by digest: ${resolution.image}`);
  }

  const containerName = `${CONVERTER_CONTAINER_PREFIX}${(deps.newId ?? (() => randomBytes(8).toString("hex")))()}`;
  const { command, args } = buildRendererCommand({
    image: resolution.image,
    containerName,
    maxRequestBytes,
    // The engine stops itself before the portal's budget has to kill the container.
    engineTimeoutSeconds: Math.max(1, Math.floor((timeoutMs * 0.85) / 1000)),
  });
  const run = deps.run ?? runProcessWithBudget;

  return (deps.limiter ?? sharedDoctoolsLimiter()).run(async () => {
    let result: BudgetedProcessResult;
    try {
      result = await run(command, args, {
        timeoutMs,
        containerName,
        stdin: wire,
        timeoutLabel: "renderer-timeout",
        maxStdoutBytes: deps.maxOutputBytes ?? DEFAULT_MAX_RENDER_OUTPUT_BYTES,
      });
    } catch (err) {
      return fail("converter-unavailable", `could not start docker: ${getErrorMessage(err)}`);
    }
    return interpretExit(result) ?? unpack(result.stdoutBytes, content.family, content.title, formats);
  });
}
