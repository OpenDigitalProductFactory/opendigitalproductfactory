// convertDocument(): the portal's one entry point to the dpf-doctools engine
// (BI-52E565DA, slice S2 of BI-815D40C6).
//
// It follows the promoter precedent: the portal already mounts the docker
// socket, so each conversion is a sibling container started with
// `docker run --rm -i` (see command.ts for every containment flag) on the
// shared runProcessWithBudget. The document goes in on stdin and the result
// comes back on stdout.
//
// Bounds, each enforced here and not left to the caller:
//   - input size: refused before anything spawns (default 50 MB);
//   - wall clock: the container is removed by name on expiry (default 120 s);
//   - output size: a runaway output is stopped the same way;
//   - concurrency: at most N conversions per process (default 2), so a batch
//     upload queues instead of starving the host.
//
// Expected failures come back as a typed result; this never throws for them.

import { randomBytes } from "node:crypto";
import {
  runProcessWithBudget,
  type BudgetedProcessOptions,
  type BudgetedProcessResult,
} from "@/lib/shared/run-process-with-budget";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { ok, type ActionFailure, type ActionSuccess } from "@/lib/shared/action-result";
import { buildConverterCommand, CONVERTER_CONTAINER_PREFIX } from "./command";
import {
  CONVERTER_SOURCE_EXTENSIONS,
  CONVERTER_TARGET_MIME,
  isConverterTarget,
  normalizeSourceExtension,
  type ConverterTarget,
} from "./formats";
import { resolveDoctoolsImage, type DoctoolsImageResolution } from "./image";

export const DEFAULT_MAX_INPUT_BYTES = 50 * 1024 * 1024;
export const DEFAULT_CONVERSION_TIMEOUT_MS = 120_000;
export const DEFAULT_CONVERSION_CONCURRENCY = 2;
/** Output cap: a converted file may legitimately outgrow its source, but not without bound. */
export const DEFAULT_MAX_OUTPUT_BYTES = 200 * 1024 * 1024;

export type ConversionFailureReason =
  | "converter-unavailable"
  | "input-too-large"
  | "timeout"
  | "conversion-failed";

export type ConvertedDocument = { bytes: Buffer; mime: string };

/**
 * Composed from the shared action-result primitive: success carries the
 * converted document as `data`; failure carries a plain-language `error` plus a
 * typed `reason` callers branch on.
 */
export type ConversionFailure = ActionFailure & { reason: ConversionFailureReason };
export type ConversionResult = ActionSuccess<ConvertedDocument> | ConversionFailure;

export type ConvertRequest = {
  input: Buffer;
  /** Source extension, a type hint only (LibreOffice detects from content). */
  from?: string;
  to: ConverterTarget;
};

export type ConversionLimiter = {
  run<T>(task: () => Promise<T>): Promise<T>;
  active(): number;
};

/** A FIFO semaphore: at most `cap` tasks run at once; the rest wait in order. */
export function createConversionLimiter(cap: number): ConversionLimiter {
  if (!Number.isInteger(cap) || cap <= 0) throw new Error("conversion concurrency cap must be a positive integer");
  let running = 0;
  const waiting: Array<() => void> = [];
  const release = () => {
    running -= 1;
    const next = waiting.shift();
    if (next) {
      running += 1;
      next();
    }
  };
  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (running < cap) running += 1;
      else await new Promise<void>((resolve) => waiting.push(resolve));
      try {
        return await task();
      } finally {
        release();
      }
    },
    active: () => running,
  };
}

function positiveEnvInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

let processLimiter: ConversionLimiter | undefined;
function defaultLimiter(): ConversionLimiter {
  processLimiter ??= createConversionLimiter(
    positiveEnvInt("DPF_CONVERT_CONCURRENCY", DEFAULT_CONVERSION_CONCURRENCY),
  );
  return processLimiter;
}

export type ConvertDeps = {
  run?: (command: string, args: string[], opts: BudgetedProcessOptions) => Promise<BudgetedProcessResult>;
  resolveImage?: () => Promise<DoctoolsImageResolution>;
  limiter?: ConversionLimiter;
  newId?: () => string;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  timeoutMs?: number;
};

/**
 * The engine's own timeout, inside the portal's budget, so dpf-convert exits
 * 124 cleanly before the portal has to kill the container.
 */
function engineTimeoutSeconds(timeoutMs: number): number {
  return Math.max(1, Math.floor((timeoutMs * 0.85) / 1000));
}

const fail = (reason: ConversionFailureReason, error: string): ConversionFailure => ({ ok: false, error, reason });

function lastLines(text: string, count = 3): string {
  return text.trim().split(/\r?\n/).slice(-count).join(" | ");
}

/**
 * Map a finished `docker run` to a result. dpf-convert's contract: 0 ok, 2 bad
 * arguments or empty input, 3 no output, 4 input too large, 124 timed out.
 * `docker run` itself exits 125 (daemon error: unreachable, image not
 * pullable), 126 (cannot invoke) or 127 (command not found).
 */
function interpret(result: BudgetedProcessResult, to: ConverterTarget): ConversionResult {
  const detail = `exit ${result.exitCode}: ${lastLines(result.stderr) || "no diagnostics"}`;
  if (result.outputLimitExceeded) return fail("conversion-failed", `output exceeded the limit; ${detail}`);
  switch (result.exitCode) {
    case 0:
      return result.stdoutBytes.length > 0
        ? ok({ bytes: result.stdoutBytes, mime: CONVERTER_TARGET_MIME[to] })
        : fail("conversion-failed", "the converter exited 0 but produced no output");
    case 4:
      return fail("input-too-large", detail);
    case 124:
      return fail("timeout", detail);
    case 125:
    case 126:
    case 127:
      return fail("converter-unavailable", detail);
    default:
      return fail("conversion-failed", detail);
  }
}

export async function convertDocument(request: ConvertRequest, deps: ConvertDeps = {}): Promise<ConversionResult> {
  const maxInputBytes = deps.maxInputBytes ?? positiveEnvInt("DPF_CONVERT_MAX_BYTES", DEFAULT_MAX_INPUT_BYTES);
  const maxOutputBytes = deps.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const timeoutMs = deps.timeoutMs ?? positiveEnvInt("DPF_CONVERT_TIMEOUT_MS", DEFAULT_CONVERSION_TIMEOUT_MS);

  if (request.input.length === 0) return fail("conversion-failed", "empty input");
  if (request.input.length > maxInputBytes) {
    return fail("input-too-large", `input is ${request.input.length} bytes; the limit is ${maxInputBytes}`);
  }
  if (!isConverterTarget(request.to)) return fail("conversion-failed", `unsupported target format: ${String(request.to)}`);
  const from = request.from === undefined ? undefined : normalizeSourceExtension(request.from);
  if (from !== undefined && !CONVERTER_SOURCE_EXTENSIONS.has(from)) {
    return fail("conversion-failed", `unsupported source format: ${request.from}`);
  }

  const resolution = await (deps.resolveImage ?? resolveDoctoolsImage)();
  if (resolution.status === "not-configured") {
    return fail("converter-unavailable", "no dpf-doctools image is configured (self_upgrade.doctoolsImage or DPF_DOCTOOLS_IMAGE)");
  }
  if (resolution.status === "unpinned") {
    return fail("converter-unavailable", `the configured dpf-doctools image is not pinned by digest: ${resolution.image}`);
  }

  const containerName = `${CONVERTER_CONTAINER_PREFIX}${(deps.newId ?? (() => randomBytes(8).toString("hex")))()}`;
  const { command, args } = buildConverterCommand({
    image: resolution.image,
    containerName,
    to: request.to,
    from,
    maxInputBytes,
    engineTimeoutSeconds: engineTimeoutSeconds(timeoutMs),
  });
  const run = deps.run ?? runProcessWithBudget;

  return (deps.limiter ?? defaultLimiter()).run(async () => {
    try {
      const result = await run(command, args, {
        timeoutMs,
        containerName,
        stdin: request.input,
        timeoutLabel: "converter-timeout",
        maxStdoutBytes: maxOutputBytes,
      });
      return interpret(result, request.to);
    } catch (err) {
      // The only throw from the runner is a failed spawn: no docker CLI here.
      return fail("converter-unavailable", `could not start docker: ${getErrorMessage(err)}`);
    }
  });
}
