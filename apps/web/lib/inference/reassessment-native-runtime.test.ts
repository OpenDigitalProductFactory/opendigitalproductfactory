import { describe, expect, it, vi } from "vitest";
import model from "./fixtures/reassessment-native-model.json";
import { validAuditedReassessmentNativeQualification } from "../shared/reassessment-native-composition";
const ports = vi.hoisted(() => ({ request: vi.fn(), scope: null as unknown }));
vi.mock("./reassessment-http-capture", () => ({ captureReassessmentHttpRequest: ports.request }));
vi.mock("../routing/reassessment-execution-scope", async load => ({
  ...await load<typeof import("../routing/reassessment-execution-scope")>(),
  currentReassessmentQualification: () => ports.scope, currentReassessmentExecution: () => null,
}));
import { captureReassessmentNativeRuntime, reassessmentNativeRuntimeUrls,
  REASSESSMENT_NATIVE_COMPOSITION, reassessmentNativeCatalogDigest, nativeRuntimeReaderFor,
  assertReassessmentNativeScreenUnchanged } from "./reassessment-native-runtime";

const provider = { providerId: "local", baseUrl: "http://dmr.invalid/engines/v1", endpoint: null };
const modelRef = "hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M";
describe("audited finite native composition", () => {
  it("refuses any screened source, prompt, tool-schema or history loss before count", () => {
    const input = { messages: [{ role: "user", content: "Complete immutable source text." }], systemPrompt: "Canonical criteria", tools: [{ schema: "exact" }] };
    expect(() => assertReassessmentNativeScreenUnchanged(input, structuredClone(input))).not.toThrow();
    for (const changed of [ { ...input, messages: [{ role: "user", content: "Complete" }] },
      { ...input, systemPrompt: "Redacted criteria" }, { ...input, tools: [] } ]) {
      expect(() => assertReassessmentNativeScreenUnchanged(input, changed)).toThrow(/screen.*changed/);
    }
  });
  it("does not accept an old ten-field proof or a changed catalog as finite production qualification", () => {
    expect(validAuditedReassessmentNativeQualification({ finiteTokenProof: { schemaVersion: 1 } })).toBe(false);
    expect(validAuditedReassessmentNativeQualification({ nativeRuntime: { schemaVersion: 2, catalogDigest: "a".repeat(64) } })).toBe(false);
  });
  it("pins the full physical/source identities separately from fresh logical reports", () => {
    expect(REASSESSMENT_NATIVE_COMPOSITION).toMatchObject({ runtimeVersion: "v1.2.8",
      runtimeSourceCommit: "5a3112fdc10bcfe236a7450fcfa7e83ed3c0209e",
      engineSourceCommit: "72874f559c598b8f89fbb24864868337cf5afb4c",
      engineExecutableDigest: "0e9095b1a9068961682fa60fa101bdcf40e0b1f1e6b0c44c1616c0611c1d4b26",
      modelDigest: "sha256:66c4f325bc71350f07fb2da4f92455553c7bbc8af5d7ee2095fbeac79b9e66c9" });
    expect(reassessmentNativeCatalogDigest()).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(REASSESSMENT_NATIVE_COMPOSITION)).toBe(true);
  });
  it("derives one exact bounded identity GET schedule from the configured endpoint", () => {
    expect(reassessmentNativeRuntimeUrls(provider, modelRef)).toEqual([
      "http://dmr.invalid/version", "http://dmr.invalid/engines/status",
      `http://dmr.invalid/engines/_configure?model=${encodeURIComponent(modelRef)}`,
      "http://dmr.invalid/models/sha256:66c4f325bc71350f07fb2da4f92455553c7bbc8af5d7ee2095fbeac79b9e66c9",
      "http://dmr.invalid/engines/v1/models",
    ]);
  });
  it.each(["http://user:secret@dmr.invalid/v1", "http://dmr.invalid/v1?model=other", "http://dmr.invalid/v1#other"])(
    "refuses an endpoint with undeclared identity or authentication", baseUrl => {
      expect(() => reassessmentNativeRuntimeUrls({ ...provider, baseUrl }, modelRef)).toThrow(/endpoint/);
    });
  it("refuses disagreement between the normal context reader and actual configured dispatch endpoint", () => {
    expect(() => reassessmentNativeRuntimeUrls({ ...provider, endpoint: "http://other.invalid/v1" }, modelRef)).toThrow(/endpoint.*conflict/);
  });
  it("performs captured sequential GETs and refuses a changed version without any model operation", async () => {
    ports.scope = { deadlineAt: new Date(Date.now() + 30_000).toISOString() }; ports.request.mockReset();
    let pending = false;
    ports.request.mockImplementation(async ({ url }: { url: string }) => {
      expect(pending).toBe(false); pending = true; await Promise.resolve(); pending = false;
      return new Response(JSON.stringify(url.endsWith("/version") ? { version: "v1.2.9" } : {}));
    });
    await expect(captureReassessmentNativeRuntime({ provider, modelRef, fetchImpl: vi.fn(), assertCurrent: async () => {} })).rejects.toThrow(/version/);
    expect(ports.request.mock.calls.every(([request]) => request.method === "GET" && request.operation === "configuration")).toBe(true);
    expect(ports.request.mock.calls.map(([request]) => request.url)).toEqual(reassessmentNativeRuntimeUrls(provider, modelRef));
  });
  it("refuses invalid UTF-8 instead of validating a lossy replacement in runtime metadata", async () => {
    const catalog = REASSESSMENT_NATIVE_COMPOSITION;
    ports.scope = { deadlineAt: new Date(Date.now() + 30_000).toISOString() }; ports.request.mockReset();
    ports.request.mockImplementation(async ({ url }: { url: string }) => {
      if (url.endsWith("/version")) return new Response(Buffer.concat([Buffer.from('{"version":"v1.2.8","extra":"'), Buffer.from([0xff]), Buffer.from('"}')]));
      return new Response(JSON.stringify(url.endsWith("/status") ? {
        "llama.cpp": `Running: llama.cpp b9879-metal (sha256:${catalog.engineArchiveDigest}) 72874f5`,
      } : url.includes("/_configure") ? [{ Backend: "llama.cpp", Model: modelRef, ModelID: catalog.modelDigest,
        Mode: "completion", Config: { "context-size": 131072 } }] : url.endsWith("/models") ? {
        data: [{ id: modelRef, dmr: { context_window: 4096 } }],
      } : model));
    });
    await expect(captureReassessmentNativeRuntime({ provider, modelRef, fetchImpl: vi.fn(), assertCurrent: async () => {} })).rejects.toThrow(/response-invalid/);
  });
  it("does not accept caller-assembled facts as a captured routing observation", () => {
    expect(() => nativeRuntimeReaderFor({ schemaVersion: 1 } as never)).toThrow(/observation/);
  });
  it("holds a captured observation in its original task/root lineage", async () => {
    const catalog = REASSESSMENT_NATIVE_COMPOSITION;
    ports.scope = { taskRunId: "original", manifest: { artifactId: "root", digest: "a".repeat(64) } };
    ports.request.mockImplementation(async ({ url }: { url: string }) => new Response(JSON.stringify(
      url.endsWith("/version") ? { version: "v1.2.8" } : url.endsWith("/status") ? {
        "llama.cpp": `Running: llama.cpp b9879-metal (sha256:${catalog.engineArchiveDigest}) 72874f5`,
      } : url.includes("/_configure") ? [{ Backend: "llama.cpp", Model: modelRef, ModelID: catalog.modelDigest,
        Mode: "completion", Config: { "context-size": 131072 } }] : url.endsWith("/models") ? {
        data: [{ id: modelRef, dmr: { context_window: 4096 } }],
      } : model,
    )));
    const observed = await captureReassessmentNativeRuntime({ provider, modelRef, fetchImpl: vi.fn(), assertCurrent: async () => {} });
    ports.scope = { taskRunId: "replacement", manifest: { artifactId: "root", digest: "a".repeat(64) } };
    expect(() => nativeRuntimeReaderFor(observed)).toThrow(/root|lineage/);
  });
  it("derives a private captured reader from the full retained model config and exact runtime reports", async () => {
    ports.scope = { deadlineAt: new Date(Date.now() + 30_000).toISOString() }; ports.request.mockReset();
    const catalog = REASSESSMENT_NATIVE_COMPOSITION;
    ports.request.mockImplementation(async ({ url }: { url: string }) => new Response(JSON.stringify(
      url.endsWith("/version") ? { version: "v1.2.8" } : url.endsWith("/status") ? {
        "llama.cpp": `Running: llama.cpp b9879-metal (sha256:${catalog.engineArchiveDigest}) 72874f5`,
      } : url.includes("/_configure") ? [{ Backend: "llama.cpp", Model: modelRef, ModelID: catalog.modelDigest,
        Mode: "completion", Config: { "context-size": 131072 } }] : url.endsWith("/models") ? {
        data: [{ id: modelRef, dmr: { context_window: 4096 } }],
      } : model,
    )));
    const observed = await captureReassessmentNativeRuntime({ provider, modelRef, fetchImpl: vi.fn(), assertCurrent: async () => {} });
    expect(observed).toMatchObject({ contextTokens: 131072, catalogDigest: reassessmentNativeCatalogDigest(),
      finiteTokenProof: { modelDigest: model.id, runtimeVersion: "v1.2.8" } });
    const reader = nativeRuntimeReaderFor(observed);
    expect(await reader(undefined, { provider, modelId: modelRef })).toMatchObject({ contextTokens: 131072,
      thinkingBudgetEvidence: { modelDigest: model.id, templateDigest: catalog.templateDigest } });
    expect(await reader(undefined, { provider, modelId: "ai/another-model:latest" })).toBeNull();
    expect(ports.request).toHaveBeenCalledTimes(5);
  });
});
