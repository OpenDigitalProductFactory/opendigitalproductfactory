/** Preserve the exact response-body bytes exposed by Fetch. Authentication
 * headers remain outside prospective capture; adapters do not consume them. */
export async function captureReassessmentHttpResponse(response: Response) {
  const secret = /^(?:x[-_])?(authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|credential|credentials)$/i;
  return { status: response.status, statusText: response.statusText,
    headers: Object.fromEntries([...response.headers].filter(([name]) => !secret.test(name))),
    bodyEncoding: "base64" as const,
    bodyBase64: Buffer.from(await response.clone().arrayBuffer()).toString("base64") };
}
import { AsyncLocalStorage } from "node:async_hooks";
import {
  assertReassessmentActive, currentReassessmentQualification, currentFiniteReassessmentExecution, isReassessmentExecutionError,
  reassessmentCaptureValue, reassessmentTokenReservationFor, refuseReassessmentExecution,
  runReassessmentEffect, runReassessmentQualificationRequest,
} from "../routing/reassessment-execution-scope";

type NativeHttpPorts = Readonly<{ fetchImpl: typeof fetch; assertCurrent(): Promise<void> }>;
const ports = new AsyncLocalStorage<{ root: string; input: NativeHttpPorts; closed: boolean }>();
const rootIdentity = (context: NonNullable<ReturnType<typeof currentFiniteReassessmentExecution>>) =>
  JSON.stringify([context.taskRunId ?? null, context.requestDigest ?? null, context.manifest ?? null, context.qualification?.qualificationDigest ?? null]);

/** Server dispatch binds its existing terminal transport before ResourceLane
 * admission. Capacity probes receive the same captured/cancelable transport. */
export async function withReassessmentHttpTransport<T>(input: NativeHttpPorts, execute: () => Promise<T>): Promise<T> {
  const current = currentFiniteReassessmentExecution();
  if (!current || ports.getStore()) return refuseReassessmentExecution("reassessment-http-transport-scope-required");
  const frame = { root: rootIdentity(current), input: Object.freeze({ fetchImpl: input.fetchImpl, assertCurrent: input.assertCurrent }), closed: false };
  try { return await ports.run(frame, execute); } finally { frame.closed = true; }
}
export function currentReassessmentHttpTransport(): NativeHttpPorts {
  const current = currentFiniteReassessmentExecution(), frame = ports.getStore();
  if (!current || !frame || frame.closed || frame.root !== rootIdentity(current)) return refuseReassessmentExecution("reassessment-http-transport-root-unavailable");
  return frame.input;
}


/** Capture/deadline transport shared by the concrete native wrappers. The
 * wrapper owns its exact URL/body contract; this function never selects a route
 * or obtains authority. Candidate GET authority is checked by the root scope. */
export async function captureReassessmentHttpRequest(input: {
  url: string; method: "GET" | "POST"; operation: "configuration" | "count" | "generation";
  fetchImpl: typeof fetch; assertCurrent(): Promise<void>; bodyUtf8?: string;
  headers?: HeadersInit; signal?: AbortSignal;
  captureAdditional?(response: Response): Promise<unknown>;
}): Promise<Response> {
  const qualification = currentReassessmentQualification();
  const context = qualification ?? assertReassessmentActive();
  if (!context) return refuseReassessmentExecution("reassessment-http-scope-required");
  if (qualification && (input.method !== "GET" || input.operation !== "configuration" || input.bodyUtf8 !== undefined)) {
    return refuseReassessmentExecution("reassessment-qualification-GET-only");
  }
  let url: URL;
  try { url = new URL(input.url); }
  catch { return refuseReassessmentExecution("reassessment-http-url-invalid"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash
    || input.method === "GET" && input.bodyUtf8 !== undefined
    || input.method === "POST" && typeof input.bodyUtf8 !== "string") return refuseReassessmentExecution("reassessment-http-request-invalid");
  let body: unknown;
  if (input.bodyUtf8 !== undefined) {
    try { body = reassessmentCaptureValue(JSON.parse(input.bodyUtf8)); }
    catch { return refuseReassessmentExecution("reassessment-http-body-invalid"); }
  }
  try { await input.assertCurrent(); }
  catch (error) {
    if (isReassessmentExecutionError(error)) throw error;
    return refuseReassessmentExecution("reassessment-current-check-failed");
  }
  const execute = () => {
    const remaining = Date.parse(context.deadlineAt) - Date.now();
    if (!Number.isSafeInteger(remaining) || remaining <= 0 || remaining > 2_147_483_647) return refuseReassessmentExecution("reassessment-deadline-exhausted");
    const deadline = AbortSignal.timeout(remaining);
    return input.fetchImpl(input.url, { method: input.method, headers: input.headers,
      ...(input.bodyUtf8 !== undefined ? { body: input.bodyUtf8 } : {}), redirect: "error",
      signal: input.signal ? AbortSignal.any([input.signal, deadline]) : deadline });
  };
  const capture = async (response: Response) => {
    const http = await captureReassessmentHttpResponse(response);
    return input.captureAdditional ? { http, observation: await input.captureAdditional(response.clone()) } : http;
  };
  if (qualification) return runReassessmentQualificationRequest({ method: "GET", url: input.url }, execute, capture);
  const current = assertReassessmentActive();
  if (!current) return refuseReassessmentExecution("reassessment-http-scope-required");
  return runReassessmentEffect({ kind: "provider", name: `${current.qualification.providerId}/${current.qualification.modelId}`,
    input: { operation: input.operation, providerId: current.qualification.providerId, modelId: current.qualification.modelId,
      providerConnectionId: current.qualification.providerConnectionId, url: input.url, method: input.method,
      ...(input.bodyUtf8 !== undefined ? { body, bodyUtf8: input.bodyUtf8 } : {}),
      ...(input.operation === "generation" ? { tokenReservation: reassessmentTokenReservationFor(input.bodyUtf8!) } : {}) } }, execute, capture);
}
