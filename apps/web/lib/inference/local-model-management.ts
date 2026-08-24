import { isRecord } from "@/lib/shared/coerce";
import { getOllamaApiRoot } from "./ollama-url";

export type LocalModelOperationStatus = "queued" | "running" | "completed" | "failed";

export type LocalModelManagementErrorCode =
  | "invalid-reference"
  | "runtime-unreachable"
  | "management-unsupported"
  | "registry-failure"
  | "runtime-failure"
  | "invalid-response";

export class LocalModelManagementError extends Error {
  constructor(
    public readonly code: LocalModelManagementErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "LocalModelManagementError";
  }
}

export type LocalModelInfo = {
  name: string;
  comparisonKey: string;
  sizeBytes: number | null;
  sizeLabel: string | null;
  createdAt: string | null;
  digest: string;
  parameterSize: string;
  quantization: string;
  architecture: string;
  format: string;
  contextSize: number | null;
};

export type LocalModelPullProgress = {
  transferredBytes: number | null;
  totalBytes: number | null;
  percent: number | null;
  message: string | null;
};

type FetchLike = typeof fetch;

type ManagementDependencies = {
  apiRoot?: string;
  fetchImpl?: FetchLike;
};

type DmrModel = {
  id?: unknown;
  tags?: unknown;
  created?: unknown;
  config?: unknown;
};

type DmrModelConfig = {
  size?: unknown;
  parameters?: unknown;
  quantization?: unknown;
  architecture?: unknown;
  format?: unknown;
  context_size?: unknown;
};

const MODEL_REFERENCE_MAX_LENGTH = 255;
const MODEL_REFERENCE_RE =
  /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)+(?::[A-Za-z0-9][A-Za-z0-9._-]*)?$/;
const SIZE_RE = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|KIB|MIB|GIB|TIB)$/i;

const SIZE_FACTORS: Readonly<Record<string, number>> = {
  B: 1,
  KB: 1_000,
  MB: 1_000 ** 2,
  GB: 1_000 ** 3,
  TB: 1_000 ** 4,
  KIB: 1024,
  MIB: 1024 ** 2,
  GIB: 1024 ** 3,
  TIB: 1024 ** 4,
};

export function parseDmrSize(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = SIZE_RE.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  const factor = SIZE_FACTORS[match[2]!.toUpperCase()];
  if (!Number.isFinite(amount) || factor === undefined) return null;
  const bytes = Math.round(amount * factor);
  return Number.isSafeInteger(bytes) ? bytes : null;
}

export function canonicalLocalModelKey(reference: string): string {
  return reference
    .trim()
    .replace(/^docker\.io\//i, "")
    .replace(/^huggingface\.co\//i, "hf.co/")
    .replace(/:latest$/i, "")
    .toLowerCase();
}

export function validateLocalModelReference(reference: string): string {
  if (
    typeof reference !== "string" ||
    reference.length === 0 ||
    reference.length > MODEL_REFERENCE_MAX_LENGTH ||
    !MODEL_REFERENCE_RE.test(reference) ||
    reference.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new LocalModelManagementError(
      "invalid-reference",
      "Enter a model reference such as ai/qwen3:8B-Q4_K_M or hf.co/org/model:quantization.",
    );
  }
  return reference;
}

export async function listLocalModels(
  dependencies: ManagementDependencies = {},
): Promise<LocalModelInfo[]> {
  const { apiRoot, fetchImpl } = resolveDependencies(dependencies);
  const response = await safeFetch(fetchImpl, `${apiRoot}/models`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    if (response.status === 404 || response.status === 405) throw unsupported(response.status);
    throw runtimeFailure(response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new LocalModelManagementError(
      "invalid-response",
      "The local model runtime returned an invalid inventory response.",
    );
  }
  if (!Array.isArray(payload)) {
    throw new LocalModelManagementError(
      "invalid-response",
      "The local model runtime returned an invalid inventory response.",
    );
  }
  return payload.map(mapDmrModel);
}

export async function installLocalModel(
  reference: string,
  onProgress: (progress: LocalModelPullProgress) => void | Promise<void>,
  dependencies: ManagementDependencies = {},
): Promise<void> {
  const modelReference = validateLocalModelReference(reference);
  const { apiRoot, fetchImpl } = resolveDependencies(dependencies);
  const response = await safeFetch(fetchImpl, `${apiRoot}/models/create`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      accept: "application/x-ndjson, application/json",
    },
    body: JSON.stringify({ from: modelReference }),
  });

  if (!response.ok) {
    const body = await readBoundedText(response);
    if (response.status === 405 || (response.status === 404 && !/model not found/i.test(body))) {
      throw unsupported(response.status);
    }
    throw new LocalModelManagementError(
      "registry-failure",
      response.status === 404
        ? "That model was not found in the registry."
        : "The local runtime could not install that model.",
      response.status,
    );
  }

  const layers = new Map<string, number>();
  await consumeNdjson(response, async (rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(record)) return;
    const type = stringValue(record.type);
    if (type === "error") {
      throw new LocalModelManagementError(
        "registry-failure",
        "The local runtime could not install that model.",
      );
    }
    if (type !== "progress") return;

    const layer = isRecord(record.layer) ? record.layer : null;
    const layerId = layer ? stringValue(layer.id) : null;
    const current = layer ? nonNegativeNumber(layer.current) : null;
    if (layerId && current !== null) layers.set(layerId, current);
    const transferredBytes = layers.size > 0 ? sum(layers.values()) : null;
    const totalBytes = nonNegativeNumber(record.total);
    const percent =
      transferredBytes !== null && totalBytes !== null && totalBytes > 0
        ? Math.min(100, Math.round((transferredBytes / totalBytes) * 100))
        : null;
    await onProgress({
      transferredBytes,
      totalBytes,
      percent,
      message: stringValue(record.message),
    });
  });
}

export async function removeLocalModel(
  reference: string,
  dependencies: ManagementDependencies = {},
): Promise<{ alreadyAbsent: boolean }> {
  const modelReference = validateLocalModelReference(reference);
  const { apiRoot, fetchImpl } = resolveDependencies(dependencies);
  const encodedReference = modelReference.split("/").map(encodeURIComponent).join("/");
  const response = await safeFetch(fetchImpl, `${apiRoot}/models/${encodedReference}`, {
    method: "DELETE",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (response.status === 404) return { alreadyAbsent: true };
  if (response.status === 405) throw unsupported(response.status);
  if (!response.ok) throw runtimeFailure(response.status);
  return { alreadyAbsent: false };
}

function resolveDependencies(dependencies: ManagementDependencies): {
  apiRoot: string;
  fetchImpl: FetchLike;
} {
  return {
    apiRoot: (dependencies.apiRoot ?? getOllamaApiRoot()).replace(/\/$/, ""),
    fetchImpl: dependencies.fetchImpl ?? fetch,
  };
}

async function safeFetch(
  fetchImpl: FetchLike,
  input: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchImpl(input, init);
  } catch (error) {
    if (error instanceof LocalModelManagementError) throw error;
    throw new LocalModelManagementError(
      "runtime-unreachable",
      "The local model runtime is unavailable.",
    );
  }
}

function mapDmrModel(value: unknown): LocalModelInfo {
  if (!isRecord(value)) invalidInventory();
  const model = value as DmrModel;
  const tags = Array.isArray(model.tags)
    ? model.tags.filter((tag): tag is string => typeof tag === "string" && tag.length > 0)
    : [];
  const digest = stringValue(model.id) ?? "";
  const name = tags[0] ?? digest;
  if (!name) invalidInventory();
  const config: DmrModelConfig = isRecord(model.config) ? model.config : {};
  const sizeBytes = parseDmrSize(config.size);
  const sizeLabel = typeof config.size === "string" && sizeBytes !== null
    ? config.size.replace(/\s*(KiB|MiB|GiB|TiB|KB|MB|GB|TB|B)$/i, " $1")
    : null;
  const created = nonNegativeNumber(model.created);
  return {
    name,
    comparisonKey: canonicalLocalModelKey(name),
    sizeBytes,
    sizeLabel,
    createdAt: created !== null && created > 0 ? new Date(created * 1000).toISOString() : null,
    digest,
    parameterSize: stringValue(config.parameters) ?? "",
    quantization: stringValue(config.quantization) ?? "",
    architecture: stringValue(config.architecture) ?? "",
    format: stringValue(config.format) ?? "",
    contextSize: nonNegativeNumber(config.context_size),
  };
}

function invalidInventory(): never {
  throw new LocalModelManagementError(
    "invalid-response",
    "The local model runtime returned an invalid inventory response.",
  );
}

function unsupported(status: number): LocalModelManagementError {
  return new LocalModelManagementError(
    "management-unsupported",
    "Model management is unavailable in this local runtime. Update Docker Model Runner to manage models here.",
    status,
  );
}

function runtimeFailure(status: number): LocalModelManagementError {
  return new LocalModelManagementError(
    "runtime-failure",
    "The local model runtime could not complete that request.",
    status,
  );
}

async function readBoundedText(response: Response, limit = 4_096): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.slice(0, limit);
}

async function consumeNdjson(
  response: Response,
  consumeLine: (line: string) => void | Promise<void>,
): Promise<void> {
  if (!response.body) {
    for (const line of (await readBoundedText(response, 2_000_000)).split(/\r?\n/)) {
      await consumeLine(line);
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    if (pending.length > 65_536 && !pending.includes("\n")) {
      throw new LocalModelManagementError(
        "invalid-response",
        "The local model runtime returned an invalid install response.",
      );
    }
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) await consumeLine(line);
    if (done) break;
  }
  if (pending.trim()) await consumeLine(pending);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}
