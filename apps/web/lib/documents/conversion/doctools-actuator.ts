import { randomBytes } from "node:crypto";
import { isRecord } from "@/lib/shared/coerce";
import { runProcessWithBudget, type BudgetedProcessResult } from "@/lib/shared/run-process-with-budget";
import { buildRendererCommand, DEFAULT_MAX_RENDER_OUTPUT_BYTES, DEFAULT_MAX_REQUEST_BYTES, DEFAULT_RENDER_TIMEOUT_MS } from "../generation/render";
import { readConverterAvailabilityAtDaemon } from "./availability";
import { buildConverterCommand, CONVERTER_CONTAINER_PREFIX } from "./command";
import { DEFAULT_CONVERSION_TIMEOUT_MS, DEFAULT_MAX_INPUT_BYTES, DEFAULT_MAX_OUTPUT_BYTES, engineTimeoutSeconds } from "./convert";
import { CONVERTER_SOURCE_EXTENSIONS, isConverterTarget } from "./formats";
import { resolveDoctoolsImage } from "./image";

type DocumentOperation = { kind: "render" } | { kind: "convert"; from?: string; to: string };

/** Renderer and converter recipes are selected inside the Docker owner. The
 * caller supplies only formats and document bytes. */
export function createDoctoolsActuator(project: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(project)) throw new Error("doctools_project_unproven");
  const limit = (operation: DocumentOperation) => operation.kind === "render" ? DEFAULT_MAX_REQUEST_BYTES : DEFAULT_MAX_INPUT_BYTES;
  const unavailable = (stderr: string): BudgetedProcessResult => ({ exitCode: 125, stdout: "", stdoutBytes: Buffer.alloc(0), stderr, outputLimitExceeded: false });
  return {
    limit,
    health: readConverterAvailabilityAtDaemon,
    async run(operation: DocumentOperation, input: Buffer): Promise<BudgetedProcessResult> {
      const maxInputBytes = limit(operation);
      if (!input.length || input.length > maxInputBytes) return { ...unavailable("document input exceeded its limit"), exitCode: 4 };
      if (operation.kind === "convert" && (!isConverterTarget(operation.to)
        || (operation.from !== undefined && !CONVERTER_SOURCE_EXTENSIONS.has(operation.from)))) {
        return { ...unavailable("unsupported document format"), exitCode: 2 };
      }
      const resolved = await resolveDoctoolsImage();
      if (resolved.status !== "pinned") return unavailable("no admitted document engine image is configured");
      const action = randomBytes(16).toString("hex");
      const containerName = `${CONVERTER_CONTAINER_PREFIX}${action}`;
      const render = operation.kind === "render";
      const timeoutMs = render ? DEFAULT_RENDER_TIMEOUT_MS : DEFAULT_CONVERSION_TIMEOUT_MS;
      const base = { image: resolved.image, containerName, engineTimeoutSeconds: engineTimeoutSeconds(timeoutMs) };
      let argv: string[];
      if (render) argv = buildRendererCommand({ ...base, maxRequestBytes: maxInputBytes }).args;
      else if (isConverterTarget(operation.to)) argv = buildConverterCommand({ ...base, to: operation.to, from: operation.from, maxInputBytes }).args;
      else return { ...unavailable("unsupported target format"), exitCode: 2 };

      const label = "dpf.doctools-action";
      const bound = `${project}/${action}`;
      const cleanup = async (name: string) => {
        if (name !== containerName) return;
        const inspected = await runProcessWithBudget("docker", ["inspect", "--type", "container", "--format",
          `{"id":{{json .Id}},"binding":{{json (index .Config.Labels "${label}")}}}`, name],
        { timeoutMs: 3_000, maxStdoutBytes: 1024, maxStderrChars: 1024 }).catch(() => null);
        if (inspected?.exitCode !== 0) return;
        const data: unknown = JSON.parse(inspected.stdout);
        if (!isRecord(data) || data.binding !== bound || typeof data.id !== "string" || !/^[a-f0-9]{64}$/.test(data.id)) return;
        await runProcessWithBudget("docker", ["rm", "-f", data.id], { timeoutMs: 5_000, maxStdoutBytes: 1024, maxStderrChars: 1024 });
      };
      return runProcessWithBudget("docker", [argv[0], "--label", `${label}=${bound}`, ...argv.slice(1)], {
        timeoutMs, containerName, stdin: input, timeoutLabel: render ? "renderer-timeout" : "converter-timeout",
        maxStdoutBytes: render ? DEFAULT_MAX_RENDER_OUTPUT_BYTES : DEFAULT_MAX_OUTPUT_BYTES,
        maxStderrChars: 3_072, binaryStdout: true, removeContainer: name => cleanup(name).catch(() => {}),
      });
    },
  };
}
