import { createOffThreadpoolFetchTransport } from "@/lib/network/off-threadpool-fetch";
import { LOCAL_INFERENCE_TIMEOUT_CEILING_MS } from "@/lib/routing/local-inference-runtime-policy";
import { currentInferenceSignal } from "./inference-admission";
import { awaitInferenceCancellation } from "@/lib/routing/governed-inference-deadline";

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

/** Preserve the selected transport's parent policy while adding caller cancellation. */
export function withInferenceCancellationFetch(fetchImpl: typeof fetch): typeof fetch {
  return (input, init) => {
    const signal = currentInferenceSignal();
    const request = fetchImpl(input, signal ? { ...init,
      signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
    } : init);
    return signal ? awaitInferenceCancellation(request, signal) : request;
  };
}

export const providerInferenceFetch = withInferenceCancellationFetch(providerInferenceTransport.fetch);
