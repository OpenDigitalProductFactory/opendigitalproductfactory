import { createOffThreadpoolFetchTransport } from "@/lib/network/off-threadpool-fetch";
import { LOCAL_INFERENCE_TIMEOUT_CEILING_MS } from "@/lib/routing/local-inference-runtime-policy";

// Provider inference is a process-lived portal capability. Reuse one dispatcher
// rather than creating an Undici Agent per call; closing it while the module is
// reachable would strand later synchronous calls and durable async polling.
// Undici's five-minute defaults otherwise cut off the governed ten-minute
// reviewer before its own deadline. Caller AbortSignals still enforce shorter
// deadlines; keep a finite transport backstop for calls without a signal.
const providerInferenceTransport = createOffThreadpoolFetchTransport({
  headersTimeoutMs: LOCAL_INFERENCE_TIMEOUT_CEILING_MS,
  bodyTimeoutMs: LOCAL_INFERENCE_TIMEOUT_CEILING_MS,
});

export const providerInferenceFetch = providerInferenceTransport.fetch;
