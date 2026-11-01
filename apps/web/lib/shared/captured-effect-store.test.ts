import { describe, expect, it, vi } from "vitest";
import { capturedTaskArtifactId, appendCapturedTaskArtifact, parseCapturedJson } from "./captured-effect-store";

const input = {
  namespace: "reassessment", manifestDigest: "b".repeat(64), taskRunId: "TR-original", taskRunRecordId: "row-original",
  agentId: "critic", kind: "reassessment-effect-reservation-v1", key: 1,
  data: { executionStatus: "reserved", event: { sequence: 1 } },
  metadata: { requestDigest: "a".repeat(64) },
};

describe("shared captured task artifacts", () => {
  it("keeps the existing reassessment artifact identity exactly", () => {
    expect(capturedTaskArtifactId(input)).toBe("ta-reassessment-" +
      "586d1e42bb82795ecb5b89d9d0fac8e536e543064833a9e78f9ef908f537e7e8");
  });
  it("isolates domains and event keys without depending on object insertion order", () => {
    expect(capturedTaskArtifactId({ ...input, key: { b: 2, a: 1 } }))
      .toBe(capturedTaskArtifactId({ ...input, key: { a: 1, b: 2 } }));
    expect(capturedTaskArtifactId({ ...input, namespace: "engagement" }))
      .not.toBe(capturedTaskArtifactId(input));
    expect(capturedTaskArtifactId({ ...input, key: 2 })).not.toBe(capturedTaskArtifactId(input));
    expect(capturedTaskArtifactId({ ...input, taskRunId: "TR-other" })).not.toBe(capturedTaskArtifactId(input));
  });
  it("appends to the original task and preserves the existing part and metadata contract", async () => {
    const create = vi.fn().mockResolvedValue({ id: "record" });
    await appendCapturedTaskArtifact({ taskArtifact: { create } } as never, input);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({
      artifactId: capturedTaskArtifactId(input), taskRunId: "row-original", producerAgentId: "critic",
      name: input.kind, parts: [{ type: input.kind, mimeType: "application/json", data: input.data }],
      metadata: input.metadata,
    });
  });
  it("does not convert a duplicate reservation into a fresh append or retry", async () => {
    const duplicate = Object.assign(new Error("unique artifact identity"), { code: "P2002" });
    const create = vi.fn().mockRejectedValue(duplicate);
    await expect(appendCapturedTaskArtifact({ taskArtifact: { create } } as never, input)).rejects.toBe(duplicate);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it.each(["", "../other", "engagement/other"])("refuses an invalid artifact namespace before writing: %s", async namespace => {
    const create = vi.fn();
    await expect(appendCapturedTaskArtifact({ taskArtifact: { create } } as never, { ...input, namespace })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});
describe("strict captured JSON", () => {
  it("accepts complete JSON and repeated names in separate objects", () => {
    expect(parseCapturedJson('{"a":[{"name":1},{"name":2}]}')).toEqual({ a: [{ name: 1 }, { name: 2 }] });
  });
  it.each([
    '{"input":{"summary":"first","summary":"second"}}',
    '{"input":{"summary":"first","summ\\u0061ry":"second"}}'.replace('\\\\u', '\\u'),
    '{"input":{"x":1,"x":2}}',
    '{"a":1} trailing',
  ])("refuses ambiguous or incomplete provider JSON before interpretation", source => {
    expect(() => parseCapturedJson(source)).toThrow();
  });
});
it("latches an uncaptured provider attempt even when a helper catches its refusal", async () => {
  const { withCapturedProviderTransportOnly, assertOrdinaryProviderTransportAllowed, assertCapturedProviderTransportClean } = await import("./captured-effect-store");
  await withCapturedProviderTransportOnly(async () => {
    expect(() => assertOrdinaryProviderTransportAllowed()).toThrow("capture-provider-transport-required");
    expect(() => assertCapturedProviderTransportClean()).toThrow("capture-unmediated-provider-attempt");
  });
  expect(() => assertOrdinaryProviderTransportAllowed()).not.toThrow();
});

it("keeps native image observations in their captured server frame and rejects JSON copies", async () => {
  const { withCapturedProviderTransportOnly, createCapturedNativeImageInputEvidence, isCapturedNativeImageInputEvidence } = await import("./captured-effect-store");
  const value = { modelId: "fixture-model", modelDigest: "sha256:" + "a".repeat(64), observationDigest: "b".repeat(64) };
  expect(() => createCapturedNativeImageInputEvidence(value)).toThrow("capture-provider-scope-required");
  let proof: unknown;
  await withCapturedProviderTransportOnly(async () => {
    proof = createCapturedNativeImageInputEvidence(value);
    expect(isCapturedNativeImageInputEvidence(proof, "fixture-model")).toBe(true);
    expect(isCapturedNativeImageInputEvidence(JSON.parse(JSON.stringify(proof)), "fixture-model")).toBe(false);
    expect(isCapturedNativeImageInputEvidence(proof, "different-model")).toBe(false);
  });
  expect(isCapturedNativeImageInputEvidence(proof, "fixture-model")).toBe(false);
  await withCapturedProviderTransportOnly(async () => expect(isCapturedNativeImageInputEvidence(proof, "fixture-model")).toBe(false));
});
