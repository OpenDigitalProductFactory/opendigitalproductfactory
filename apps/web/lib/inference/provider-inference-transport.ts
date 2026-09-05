import { createOffThreadpoolFetchTransport } from "@/lib/network/off-threadpool-fetch";

// Provider inference is a process-lived portal capability. Reuse one dispatcher
// rather than creating an Undici Agent per call; closing it while the module is
// reachable would strand later synchronous calls and durable async polling.
const providerInferenceTransport = createOffThreadpoolFetchTransport();

export const providerInferenceFetch = providerInferenceTransport.fetch;
