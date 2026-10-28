import { beforeEach, describe, expect, it, vi } from "vitest";
const scoped = vi.hoisted(() => ({ context: null as null | Record<string, unknown>, qualification: false,
  effect: vi.fn(), qualificationRequest: vi.fn() }));
vi.mock("../routing/reassessment-execution-scope", async load => ({
  ...await load<typeof import("../routing/reassessment-execution-scope")>(),
  assertReassessmentActive: () => scoped.context,
  currentFiniteReassessmentExecution: () => scoped.qualification ? null : scoped.context,
  currentReassessmentQualification: () => scoped.qualification ? scoped.context : null,
  runReassessmentEffect: scoped.effect, runReassessmentQualificationRequest: scoped.qualificationRequest,
}));
import { captureReassessmentHttpResponse, captureReassessmentHttpRequest,
  withReassessmentHttpTransport, currentReassessmentHttpTransport } from "./reassessment-http-capture";

describe("lossless reassessment HTTP observation", () => {
  it("preserves BOM and invalid UTF-8 without consuming the adapter's body", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0xc0, 0x80, 0xff]);
    const response = new Response(bytes, { status: 200 });
    const capture = await captureReassessmentHttpResponse(response);
    expect(Buffer.from(capture.bodyBase64, "base64")).toEqual(Buffer.from(bytes));
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(bytes));
  });
  it("retains retry and response semantics while excluding authentication", async () => {
    const capture = await captureReassessmentHttpResponse(new Response("retry", { status: 429,
      headers: { "Retry-After": "12", Location: "/next", "Content-Encoding": "identity",
        "X-Provider-Semantic": "retained", "Set-Cookie": "secret", Authorization: "secret",
        "X-Api-Key": "secret", "X-Access-Token": "secret", "Proxy-Authorization": "secret" } }));
    expect(capture.headers).toMatchObject({ "retry-after": "12", location: "/next",
      "content-encoding": "identity", "x-provider-semantic": "retained" });
    expect(JSON.stringify(capture)).not.toContain("secret");
  });
});

describe("captured native HTTP boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks(); scoped.qualification = false;
    scoped.context = { deadlineAt: new Date(Date.now() + 30_000).toISOString(),
      qualification: { providerId: "local", modelId: "model", providerConnectionId: "account" } };
    const effect = async (_event: unknown, execute: () => Promise<Response>, capture: (response: Response) => Promise<unknown>) => {
      const response = await execute(); await capture(response); return response;
    };
    scoped.effect.mockImplementation(effect); scoped.qualificationRequest.mockImplementation(effect);
  });
  function request() {
    return { url: "http://dmr.invalid/version", method: "GET" as const, operation: "configuration" as const,
      fetchImpl: vi.fn(async () => new Response("full observation", { status: 200 })), assertCurrent: vi.fn(async () => {}) };
  }
  it("reserves qualification GET capture before HTTP with the inherited deadline and no redirects", async () => {
    scoped.qualification = true; const input = request();
    await captureReassessmentHttpRequest(input);
    expect(scoped.qualificationRequest).toHaveBeenCalledWith({ method: "GET", url: input.url }, expect.any(Function), expect.any(Function));
    expect(scoped.effect).not.toHaveBeenCalled();
    expect(input.fetchImpl).toHaveBeenCalledWith(input.url, expect.objectContaining({ method: "GET", redirect: "error", signal: expect.any(AbortSignal) }));
    expect(input.assertCurrent).toHaveBeenCalledOnce();
  });
  it("refuses current-check or pre-effect capture loss without starting HTTP", async () => {
    const input = request(); input.assertCurrent.mockRejectedValueOnce(new Error("account changed"));
    await expect(captureReassessmentHttpRequest(input)).rejects.toThrow(/current/);
    expect(input.fetchImpl).not.toHaveBeenCalled();
    input.assertCurrent.mockResolvedValue(undefined); scoped.effect.mockRejectedValueOnce(new Error("capture failed"));
    await expect(captureReassessmentHttpRequest(input)).rejects.toThrow(/capture/);
    expect(input.fetchImpl).not.toHaveBeenCalled();
  });
  it("cannot use qualification to count or generate and cannot dispatch without a scope", async () => {
    scoped.qualification = true; const input = request();
    await expect(captureReassessmentHttpRequest({ ...input, method: "POST", operation: "count", bodyUtf8: "{}" })).rejects.toThrow(/qualification/);
    scoped.qualification = false; scoped.context = null;
    await expect(captureReassessmentHttpRequest(input)).rejects.toThrow(/scope/);
    expect(input.fetchImpl).not.toHaveBeenCalled();
  });
  it("captures complete count bytes without fictional token usage and omits authentication headers", async () => {
    const input = request();
    await captureReassessmentHttpRequest({ ...input, method: "POST", operation: "count", bodyUtf8: '{"model":"exact"}',
      headers: { "X-Api-Key": "fixture-secret" } });
    const event = scoped.effect.mock.calls[0]![0];
    expect(event.input).toMatchObject({ operation: "count", bodyUtf8: '{"model":"exact"}', body: { model: "exact" } });
    expect(JSON.stringify(event)).not.toContain("fixture-secret"); expect(event.input).not.toHaveProperty("usage");
  });
  it("binds capacity transport ports to the actual root and expires them with that execution", async () => {
    expect(() => currentReassessmentHttpTransport()).toThrow(/transport/);
    const input = request();
    await withReassessmentHttpTransport(input, async () => {
      expect(currentReassessmentHttpTransport().fetchImpl).toBe(input.fetchImpl);
      scoped.context = { ...scoped.context, taskRunId: "other-root" };
      expect(() => currentReassessmentHttpTransport()).toThrow(/root|transport/);
    });
    expect(() => currentReassessmentHttpTransport()).toThrow(/transport/);
  });
});
