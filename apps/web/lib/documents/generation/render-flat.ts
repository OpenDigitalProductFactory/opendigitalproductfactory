// renderFlatDocument(): export a flat-ODF document DPF wrote itself through
// dpf-render's trusted document mode (BI-BFF142A1).
//
// dpf-convert keeps DisableActiveContent on, so it refuses any ODF file with an
// embedded chart: it is the path for untrusted, customer-supplied files. A
// document DPF generated (the Workbook export's flat ODS, with its bar chart)
// goes to dpf-render instead, which relaxes that one switch in its per-run
// profile. dpf-render screens the document before the engine opens it: no
// scripts, event bindings, DDE, applets, plugins, OLE objects or external links,
// and embedded objects only as inline chart sub-documents that pass the same
// screen. Macros stay off on both paths.
//
// Same runtime as renderDocument: the containment flags, the shared concurrency
// cap and the typed failures. The request never carries customer bytes.

import { randomBytes } from "node:crypto";
import { runProcessWithBudget, type BudgetedProcessResult } from "@/lib/shared/run-process-with-budget";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { ok, type ActionSuccess } from "@/lib/shared/action-result";
import { CONVERTER_CONTAINER_PREFIX } from "@/lib/documents/conversion/command";
import { sharedDoctoolsLimiter } from "@/lib/documents/conversion/convert";
import { resolveDoctoolsImage } from "@/lib/documents/conversion/image";
import { readTar } from "./tar";
import {
  buildRendererCommand,
  DEFAULT_MAX_RENDER_OUTPUT_BYTES,
  DEFAULT_MAX_REQUEST_BYTES,
  DEFAULT_RENDER_TIMEOUT_MS,
  interpretRenderExit,
  RENDER_FORMAT_MIME,
  renderFailure,
  type RenderDeps,
  type RenderedFile,
  type RenderFailure,
} from "./render";
import type { RenderFormat } from "./spec";

/** The flat-ODF families dpf-render exports in document mode, and what each may become. */
export const FLAT_DOCUMENT_FORMATS = {
  fods: ["xlsx", "ods", "pdf"],
  fodt: ["docx", "odt", "pdf"],
} as const satisfies Record<string, readonly RenderFormat[]>;

export type FlatDocumentExt = keyof typeof FLAT_DOCUMENT_FORMATS;
export type FlatDocumentFormat<E extends FlatDocumentExt> = (typeof FLAT_DOCUMENT_FORMATS)[E][number];

export type FlatDocumentRequest<E extends FlatDocumentExt = FlatDocumentExt> = {
  ext: E;
  /** The flat-ODF XML DPF generated. */
  xml: string;
  formats: FlatDocumentFormat<E>[];
};

export type FlatDocumentResult = ActionSuccess<RenderedFile[]> | RenderFailure;

type FlatDeps = Pick<RenderDeps, "run" | "resolveImage" | "limiter" | "newId" | "timeoutMs" | "maxRequestBytes" | "maxOutputBytes">;

function unpackFiles(archive: Buffer, formats: RenderFormat[]): FlatDocumentResult {
  let entries: Map<string, Buffer>;
  try {
    entries = new Map(readTar(archive).map((entry) => [entry.name, entry.data]));
  } catch (err) {
    return renderFailure("render-failed", `the engine's output is unreadable: ${getErrorMessage(err)}`);
  }
  const missing = formats.map((format) => `document.${format}`).filter((name) => !entries.get(name)?.length);
  if (missing.length > 0) return renderFailure("render-failed", `the engine did not return ${missing.join(", ")}`);
  return ok(formats.map((format) => ({ format, bytes: entries.get(`document.${format}`)!, mime: RENDER_FORMAT_MIME[format] })));
}

export async function renderFlatDocument<E extends FlatDocumentExt>(
  request: FlatDocumentRequest<E>,
  deps: FlatDeps = {},
): Promise<FlatDocumentResult> {
  const allowed: readonly string[] = FLAT_DOCUMENT_FORMATS[request.ext] ?? [];
  const formats = [...new Set(request.formats)] as RenderFormat[];
  if (formats.length === 0 || formats.some((format) => !allowed.includes(format))) {
    return renderFailure("invalid-spec", `a .${request.ext} document exports to ${allowed.join(", ") || "nothing"}, not ${formats.join(", ") || "nothing"}`);
  }
  if (!request.xml) return renderFailure("invalid-spec", "the document is empty");

  const timeoutMs = deps.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  const maxRequestBytes = deps.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  const wire = Buffer.from(
    JSON.stringify({ document: { ext: request.ext, data: Buffer.from(request.xml, "utf8").toString("base64") }, formats }),
    "utf8",
  );
  if (wire.length > maxRequestBytes) {
    return renderFailure("input-too-large", `the document export request is ${wire.length} bytes; the limit is ${maxRequestBytes}`);
  }

  const resolution = await (deps.resolveImage ?? resolveDoctoolsImage)();
  if (resolution.status === "not-configured") {
    return renderFailure("converter-unavailable", "no dpf-doctools image is configured (self_upgrade.doctoolsImage or DPF_DOCTOOLS_IMAGE)");
  }
  if (resolution.status === "unpinned") {
    return renderFailure("converter-unavailable", `the configured dpf-doctools image is not pinned by digest: ${resolution.image}`);
  }

  const containerName = `${CONVERTER_CONTAINER_PREFIX}${(deps.newId ?? (() => randomBytes(8).toString("hex")))()}`;
  const { command, args } = buildRendererCommand({
    image: resolution.image,
    containerName,
    maxRequestBytes,
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
      return renderFailure("converter-unavailable", `could not start docker: ${getErrorMessage(err)}`);
    }
    return interpretRenderExit(result) ?? unpackFiles(result.stdoutBytes, formats);
  });
}
