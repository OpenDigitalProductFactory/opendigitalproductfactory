import { isRecord } from "@/lib/shared/coerce";
import { isTerminalQuiescenceStatus } from "@/lib/self-upgrade/quiescence-contract";

export const MANAGED_REQUEST_ACCEPTANCE_MS = 120000;
export function createManagedInferenceRequestId(now = Date.now(), random = crypto.randomUUID()): string {
  const suffix = random.replaceAll("-", "").slice(0, 20);
  if (!Number.isSafeInteger(now) || now < Date.UTC(2020, 0, 1) || now >= 2 ** 48 || !/^[a-f0-9]{20}$/.test(suffix)) throw new Error("Invalid native request identity");
  return now.toString(16).padStart(12, "0") + suffix;
}
export function parseManagedInferenceRequestId(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) return null;
  const issuedAtMs = Number.parseInt(value.slice(0, 12), 16);
  if (issuedAtMs < Date.UTC(2020, 0, 1)) return null;
  const actionKey = `ra_native_${value}`;
  return { requestId: value, issuedAtMs, acceptByMs: issuedAtMs + MANAGED_REQUEST_ACCEPTANCE_MS,
    actionKey, triggerRefId: `inference-runtime:${actionKey}` };
}
export type ManagedInferenceRequestIdentity = NonNullable<ReturnType<typeof parseManagedInferenceRequestId>>;
export function managedInferenceReportSettlement(outcome: string, evidence: unknown): "succeeded" | "failed-restored" | "unknown" {
  if (!isRecord(evidence) || evidence.settlement !== "confirmed") return "unknown";
  if (outcome === "succeeded" && ["active", "rolled-back"].includes(String(evidence.nativeStatus))) return "succeeded";
  if (outcome === "failed" && ["failed-restored", "not-started"].includes(String(evidence.nativeStatus))) return "failed-restored";
  return "unknown";
}
export type ManagedInferenceRequestObservation = {
  requestId: string; actionKey: string; state: "unknown" | "preparing" | "running" | "finishing" | "completed" | "restored" | "not-started" | "not-received";
  recorded: boolean; canSubmitNewRequest: boolean; message: string;
};
/** Absence is definitive only when read under the SAME start/queue lock after
 * the identity's fixed first-acceptance deadline. No caller timestamp renews it. */
export function classifyManagedInferenceRequest(input: { request: ManagedInferenceRequestIdentity; nowMs: number;
  action: { status: string; dispatchNonce?: string | null; evidence?: unknown } | null;
  drain: { runId: string; status: string } | null; globalRunId: string | null }): ManagedInferenceRequestObservation {
  const { request, action, drain } = input;
  const result = (state: ManagedInferenceRequestObservation["state"], canSubmitNewRequest: boolean, message: string) =>
    ({ requestId: request.requestId, actionKey: request.actionKey, state, recorded: !!action || !!drain, canSubmitNewRequest, message });
  const closed = !!drain && isTerminalQuiescenceStatus(drain.status) && input.globalRunId !== drain.runId;
  if (!action) {
    if (drain) return closed ? result("not-started", true, "The original request ended before a host action was queued.")
      : result("preparing", false, "The original request is preparing its processing window. Another change is blocked.");
    return input.nowMs >= request.acceptByMs ? result("not-received", true, "The original request was not accepted before its deadline. A fresh request is safe.")
      : result("unknown", false, "The original request has no confirmed acknowledgement yet. Keep its identity while checking.");
  }
  if (["queued", "claimed", "running"].includes(action.status)) return result("running", false, "The original host procedure is still in progress.");
  const settlement = managedInferenceReportSettlement(action.status, action.evidence);
  if (settlement !== "unknown") {
    if (!closed) return result("finishing", false, "The host reported a confirmed outcome. Its original pause is still closing.");
    return settlement === "succeeded" ? result("completed", true, "The host procedure completed. Application and performance verification remain separate.")
      : result("restored", true, "The host confirmed no change or restoration of the prior engine.");
  }
  if (!action.dispatchNonce && ["failed", "timed-out"].includes(action.status) && closed) {
    return result("not-started", true, "The original request ended without a signed host dispatch.");
  }
  return result("unknown", false, "The original host outcome is uncertain. Reconcile that request before another change.");
}
