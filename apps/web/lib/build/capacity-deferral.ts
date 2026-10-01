// apps/web/lib/build/capacity-deferral.ts
//
// A Build Studio dispatch that could not get the host is capacity backpressure,
// not a model verdict: the local provider defers while a local-CI gate holds
// the machine (~195s per gate on the reference install), and the admission
// gate times out when every slot is busy. BI-0B95D268 already keeps a killed
// engine from counting as a failed design/plan round; this names the other
// infrastructure class so the repair budgets stop being spent on a busy host
// (BI-5098ECEC). Pure: no DB, no clock.

import { isAdmissionTimeout } from "@/lib/inference/inference-admission";

export type CapacityDeferral = {
  /** When the blocking claim is expected to release the host, if the error carried it. */
  expectedFreeAt: Date | null;
  /** Operator-facing sentence; engine-neutral, names the window when known. */
  message: string;
};

const HOST_GPU_BUSY_MESSAGE =
  "Deferred: the local GPU is in use by another program, so the local model waits until the card is free — capacity backpressure, not a model verdict.";
const LOCAL_RUNNER_BUSY_MESSAGE =
  "Deferred: another local model request already holds the GPU — capacity backpressure, not a model verdict.";

function describeCapacityError(err: Error): CapacityDeferral | null {
  if (err.name === "LocalProviderCapacityDeferredError") {
    const reason = (err as { reason?: unknown }).reason;
    if (reason === "host-gpu-busy") return { expectedFreeAt: null, message: HOST_GPU_BUSY_MESSAGE };
    if (reason === "local-runner-busy") return { expectedFreeAt: null, message: LOCAL_RUNNER_BUSY_MESSAGE };
    const expectedFreeAt = (err as { expectedFreeAt?: Date | null }).expectedFreeAt ?? null;
    const window = expectedFreeAt instanceof Date && !Number.isNaN(expectedFreeAt.getTime())
      ? ` The host is expected free at ${expectedFreeAt.toISOString()}.`
      : "";
    return {
      expectedFreeAt: expectedFreeAt instanceof Date ? expectedFreeAt : null,
      message: `Deferred: the local host is reserved by a local-CI gate — capacity backpressure, not a model verdict.${window}`,
    };
  }
  if (isAdmissionTimeout(err)) {
    return {
      expectedFreeAt: null,
      message: "Deferred: every inference slot stayed busy for the whole wait — capacity backpressure, not a model verdict.",
    };
  }
  return null;
}

export function describeCapacityDeferral(err: unknown): CapacityDeferral | null {
  let current: unknown = err;
  for (let hop = 0; hop < 4; hop++) {
    if (!(current instanceof Error)) return null;
    const described = describeCapacityError(current);
    if (described) return described;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}
