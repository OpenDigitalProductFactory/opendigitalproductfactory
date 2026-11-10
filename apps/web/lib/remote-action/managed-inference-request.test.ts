import { expect, it } from "vitest";
import { createManagedInferenceRequestId, parseManagedInferenceRequestId, classifyManagedInferenceRequest } from "./managed-inference-request";

it("binds the first-acceptance deadline into a stable request identity", () => {
  const now = Date.parse("2026-10-28T22:00:00Z");
  const id = createManagedInferenceRequestId(now, "12345678-1234-1234-1234-123456789abc");
  const request = parseManagedInferenceRequestId(id)!;
  expect(request.issuedAtMs).toBe(now); expect(request.acceptByMs).toBe(now + 120000);
  expect(request.actionKey).toBe("ra_native_" + id);
  expect(parseManagedInferenceRequestId(id + "x")).toBeNull();
});
it("does not treat a missing prequeue row as rejection before the original acceptance deadline", () => {
  const request = parseManagedInferenceRequestId(createManagedInferenceRequestId(1700000000000))!;
  expect(classifyManagedInferenceRequest({ request, action: null, drain: null, globalRunId: null, nowMs: request.issuedAtMs + 1000 }).canSubmitNewRequest).toBe(false);
  expect(classifyManagedInferenceRequest({ request, action: null, drain: null, globalRunId: null, nowMs: request.acceptByMs + 1 }))
    .toMatchObject({ state: "not-received", canSubmitNewRequest: true });
});
it("keeps a terminal unknown host outcome latched even after the global pause ends", () => {
  const request = parseManagedInferenceRequestId(createManagedInferenceRequestId())!;
  expect(classifyManagedInferenceRequest({ request, nowMs: Date.now(), globalRunId: null,
    drain: { runId: "QR-original", status: "failed" }, action: { status: "failed", dispatchNonce: "original",
      evidence: { nativeStatus: "uncertain", settlement: "unknown" } } })).toMatchObject({ state: "unknown", canSubmitNewRequest: false });
});
it("permits a fresh operation only after the original confirmed restoration and its own pause settle", () => {
  const request = parseManagedInferenceRequestId(createManagedInferenceRequestId())!;
  const input = { request, nowMs: Date.now(), globalRunId: "QR-original", drain: { runId: "QR-original", status: "ready-to-swap" },
    action: { status: "failed", dispatchNonce: "original", evidence: { nativeStatus: "failed-restored", settlement: "confirmed" } } };
  expect(classifyManagedInferenceRequest(input).canSubmitNewRequest).toBe(false);
  expect(classifyManagedInferenceRequest({ ...input, globalRunId: null, drain: { runId: "QR-original", status: "failed" } }))
    .toMatchObject({ state: "restored", canSubmitNewRequest: true });
});
