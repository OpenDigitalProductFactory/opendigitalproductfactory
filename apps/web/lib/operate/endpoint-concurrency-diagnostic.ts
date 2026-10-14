// BI-B550D9E5: optional evidence inside the existing endpoint tester.
import { callProvider, type InferenceResult } from "@/lib/ai-inference";
import { isLocalProviderId } from "@/lib/routing/provider-locality";
import { resolveDefaultExecutionAdapter } from "@/lib/routing/execution-plan";
import { createRoutingTraceId } from "@/lib/routing/routing-trace";
import { LocalProviderCapacityDeferredError } from "@/lib/routing/local-provider-capacity";
import { InferenceError } from "@/lib/routing/inference-error";
import { isRecord } from "@/lib/shared/coerce";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { withInferenceAdmissionObserver, isAdmissionTimeout, type InferenceAdmissionEvent } from "@/lib/inference/inference-admission";
import { awaitInferenceCancellation, currentInferenceSignal, currentInferenceOrigin, withInferenceCancellation, withInferenceOrigin,
  GovernedInferenceDeadlineError } from "@/lib/routing/governed-inference-deadline";

type Outcome = "passed" | "failed" | "deferred";
type Caller = {
  callerIndex: number; traceId: string; outcome: Outcome; reason: string;
  content: string; contentCaptured: boolean; finishReason: string | null;
  truncated: boolean | null; inputTokens: number | null; outputTokens: number | null;
  released: boolean;
};
type AdmissionEvidence = InferenceAdmissionEvent & { callerIndex: number; order: number };
type DiagnosticCall = (input: { providerId: string; modelId: string; traceId: string }) => Promise<InferenceResult>;
class ObservationTimeout extends Error {}

/** Explicit selection only; ordinary probe defaults must not widen this run. */
export function assertEndpointConcurrencySelection(selection: {
  endpointId?: string; modelId?: string; taskType?: string; probesOnly?: boolean;
  allModels?: boolean; allEndpoints?: boolean;
}): void {
  if (!selection.endpointId || !isLocalProviderId(selection.endpointId)
    || !selection.modelId?.trim() || selection.modelId === "default"
    || selection.taskType || selection.probesOnly || selection.allModels || selection.allEndpoints) {
    throw new Error("Concurrency diagnostics require one explicit local provider and model, without probes, scenarios or exhaustive options");
  }
}

function finishReason(raw: unknown): string | null {
  if (!isRecord(raw) || !Array.isArray(raw.choices)) return null;
  const choice = raw.choices[0];
  return isRecord(choice) && typeof choice.finish_reason === "string" ? choice.finish_reason : null;
}

async function callDiagnostic(input: Parameters<DiagnosticCall>[0]): Promise<InferenceResult> {
  const { providerId, modelId, traceId } = input;
  return await callProvider(providerId, modelId, [{ role: "user", content: "Reply with READY." }],
    "This is a read-only inference diagnostic. Reply only with READY. Do not perform actions.", undefined,
    { providerId, modelId, recipeId: null, contractFamily: "model-calibration.endpoint-diagnostic",
      executionAdapter: resolveDefaultExecutionAdapter(providerId), maxTokens: 512,
      providerSettings: {}, toolPolicy: {}, responsePolicy: {} }, undefined, undefined, { traceId });
}

/** One finite observation, two ordinary calls, no slot reservation or retries. */
export async function runEndpointConcurrencyDiagnostic(
  providerId: string, modelId: string, call: DiagnosticCall = callDiagnostic,
): Promise<{ outcome: Outcome; reason: string; contentionObserved: boolean; callers: Caller[]; events: AdmissionEvidence[] }> {
  assertEndpointConcurrencySelection({ endpointId: providerId, modelId });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ObservationTimeout("Diagnostic timed out after 30 seconds")), 30_000);
  timer.unref?.();
  const events: AdmissionEvidence[] = [];
  const origin = currentInferenceOrigin();
  let closed = false;
  try {
    return await withInferenceCancellation(controller.signal, () => withInferenceOrigin(origin, async () => {
      const signal = currentInferenceSignal()!;
      const callers = await Promise.all([0, 1].map(async callerIndex => {
        const traceId = createRoutingTraceId();
        const base: Caller = { callerIndex, traceId, outcome: "deferred", reason: "",
          content: "", contentCaptured: false, finishReason: null, truncated: null,
          inputTokens: null, outputTokens: null, released: false };
        return await withInferenceAdmissionObserver(event => {
          if (!closed) events.push({ ...event, callerIndex, order: events.length });
        }, async (): Promise<Caller> => {
          try {
            signal.throwIfAborted();
            const answer = await awaitInferenceCancellation(call({ providerId, modelId, traceId }), signal);
            const reason = finishReason(answer.raw);
            const contentCaptured = answer.content.length <= 4096;
            const incomplete = answer.truncated === true || reason !== "stop" || !contentCaptured;
            const empty = !answer.content.trim() || (answer.toolCalls?.length ?? 0) > 0;
            return { ...base, content: answer.content.slice(0, 4096), contentCaptured,
              finishReason: reason, truncated: answer.truncated ?? null,
              inputTokens: answer.inputTokens, outputTokens: answer.outputTokens,
              outcome: incomplete ? "deferred" : empty ? "failed" : "passed",
              reason: incomplete ? "Answer completion remains unverified" : empty ? "No complete textual answer" : "Complete textual answer" };
          } catch (error) {
            const deferred = signal.aborted || isAdmissionTimeout(error)
              || error instanceof LocalProviderCapacityDeferredError || error instanceof InferenceError
              || error instanceof GovernedInferenceDeadlineError;
            return { ...base, outcome: deferred ? "deferred" : "failed", reason: getErrorMessage(error) };
          }
        });
      }));
      for (const caller of callers) {
        caller.released = events.some(e => e.callerIndex === caller.callerIndex && e.engineKey === "local" && e.phase === "released");
      }
      // Sequence, not elapsed time, proves the handoff even within one millisecond.
      const position = (caller: number, phase: InferenceAdmissionEvent["phase"]) =>
        events.find(e => e.callerIndex === caller && e.engineKey === "local" && e.origin === origin && e.phase === phase)?.order ?? -1;
      const contentionObserved = [0, 1].some(waiting => {
        const holder = 1 - waiting;
        const acquired = position(holder, "acquired"), queued = position(waiting, "queued");
        const released = position(holder, "released"), handedOff = position(waiting, "acquired");
        return acquired >= 0 && acquired < queued && queued < released && released < handedOff;
      });
      const failed = callers.some(c => c.outcome === "failed");
      const complete = callers.every(c => c.outcome === "passed" && c.released);
      const outcome: Outcome = failed ? "failed" : complete && contentionObserved ? "passed" : "deferred";
      return { outcome, reason: failed ? "A caller did not produce a complete answer"
        : outcome === "passed" ? "Two complete answers with observed queued handoff and release"
        : "Contention and complete answers remain unverified", contentionObserved,
        callers, events: events.map(e => ({ ...e })) };
    }));
  } finally {
    closed = true;
    clearTimeout(timer);
    if (!controller.signal.aborted) controller.abort(new ObservationTimeout("Diagnostic observation closed"));
  }
}
