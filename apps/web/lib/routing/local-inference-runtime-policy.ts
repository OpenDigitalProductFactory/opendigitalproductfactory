/**
 * Canonical runtime policy for governed local inference.
 *
 * Installer selection and reviewer trust answer different questions. The
 * installer chooses a broadly compatible model for a host; this policy keeps
 * the explicitly selected, slower 27B reviewer usable without letting generic
 * timeout configuration wait forever.
 */

export const LOCAL_INFERENCE_TIMEOUT_CEILING_MS = 600_000;
export const DEFAULT_LOCAL_INFERENCE_TIMEOUT_MS = 120_000;
export const DEFAULT_CLOUD_INFERENCE_TIMEOUT_MS = 180_000;

export const GOVERNED_LOCAL_REVIEWER = {
  modelId: "hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M",
  role: "high-trust-reviewer",
  inferenceTimeoutMs: LOCAL_INFERENCE_TIMEOUT_CEILING_MS,
} as const;

export type InferenceRuntimePolicy = {
  effectiveTimeoutMs: number;
  timeoutCeilingMs: number | null;
  source: "governed-reviewer-policy" | "operator-local-timeout" | "local-default" | "operator-default-timeout" | "provider-default";
  role: "high-trust-reviewer" | "general-local" | "provider";
};

type TimeoutConfiguration = {
  localTimeoutMs?: string | number | null;
  defaultTimeoutMs?: string | number | null;
};

function modelComparisonKey(modelId: string): string {
  return modelId
    .trim()
    .replace(/^docker\.io\//i, "")
    .replace(/^huggingface\.co\//i, "hf.co/")
    .replace(/:latest$/i, "")
    .toLowerCase();
}

function boundedTimeout(
  raw: string | number | null | undefined,
  fallback: number,
  ceiling: number | null,
): {
  value: number;
  configured: boolean;
} {
  const parsed = raw == null || raw === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return { value: fallback, configured: false };
  return {
    value: ceiling === null ? Math.trunc(parsed) : Math.min(ceiling, Math.trunc(parsed)),
    configured: true,
  };
}

export function resolveInferenceRuntimePolicy(
  providerId: string,
  modelId: string,
  configuration: TimeoutConfiguration,
): InferenceRuntimePolicy {
  if (
    providerId === "local"
    && modelComparisonKey(modelId) === modelComparisonKey(GOVERNED_LOCAL_REVIEWER.modelId)
  ) {
    return {
      effectiveTimeoutMs: GOVERNED_LOCAL_REVIEWER.inferenceTimeoutMs,
      timeoutCeilingMs: LOCAL_INFERENCE_TIMEOUT_CEILING_MS,
      source: "governed-reviewer-policy",
      role: GOVERNED_LOCAL_REVIEWER.role,
    };
  }

  if (providerId === "local") {
    const timeout = boundedTimeout(
      configuration.localTimeoutMs,
      DEFAULT_LOCAL_INFERENCE_TIMEOUT_MS,
      LOCAL_INFERENCE_TIMEOUT_CEILING_MS,
    );
    return {
      effectiveTimeoutMs: timeout.value,
      timeoutCeilingMs: LOCAL_INFERENCE_TIMEOUT_CEILING_MS,
      source: timeout.configured ? "operator-local-timeout" : "local-default",
      role: "general-local",
    };
  }

  const timeout = boundedTimeout(configuration.defaultTimeoutMs, DEFAULT_CLOUD_INFERENCE_TIMEOUT_MS, null);
  return {
    effectiveTimeoutMs: timeout.value,
    timeoutCeilingMs: null,
    source: timeout.configured ? "operator-default-timeout" : "provider-default",
    role: "provider",
  };
}

export function createInferenceTimeoutSignal(
  timeoutMs: number,
  factory: (milliseconds: number) => AbortSignal = AbortSignal.timeout,
): AbortSignal {
  return factory(timeoutMs);
}

export function resolveLocalReviewerRuntimeDiagnostics(
  configuration: TimeoutConfiguration,
): {
  modelId: string;
  role: "high-trust-reviewer";
  effectiveTimeoutMs: number;
  timeoutCeilingMs: number;
  timeoutSource: InferenceRuntimePolicy["source"];
} {
  const policy = resolveInferenceRuntimePolicy("local", GOVERNED_LOCAL_REVIEWER.modelId, configuration);
  return {
    modelId: GOVERNED_LOCAL_REVIEWER.modelId,
    role: GOVERNED_LOCAL_REVIEWER.role,
    effectiveTimeoutMs: policy.effectiveTimeoutMs,
    timeoutCeilingMs: policy.timeoutCeilingMs ?? LOCAL_INFERENCE_TIMEOUT_CEILING_MS,
    timeoutSource: policy.source,
  };
}
