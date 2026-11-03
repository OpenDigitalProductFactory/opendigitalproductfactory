import { describe, expect, it } from "vitest";
import { currentExecutionProof, QUOTA_PROOF_TTL_MS } from "./execution-proof";

const now = Date.parse("2026-10-30T01:00:00Z");
const binding = { providerId: "chatgpt", connectionId: "provider-default-chatgpt", modelId: "gpt-6.1-sol",
  accountVersion: "a".repeat(64), credentialRevision: "b".repeat(64), modelRevision: "c".repeat(64),
  endpointRevision: "d".repeat(64), quotaRevision: "e".repeat(64), adapter: "responses" as const };
const proof = { version: 1, ...binding, observedAt: now, expiresAt: now + QUOTA_PROOF_TTL_MS };

describe("exact subscription execution proof", () => {
  it("qualifies only the observed account/model/endpoint contract", () => {
    expect(currentExecutionProof(proof, binding, now)).toEqual(proof);
    for (const key of Object.keys(binding) as Array<keyof typeof binding>) {
      expect(currentExecutionProof(proof, { ...binding, [key]: "different" }, now)).toBeNull();
    }
  });
  it("cannot qualify another model or CLI from a Responses completion", () => {
    expect(currentExecutionProof(proof, { ...binding, modelId: "another-model" }, now)).toBeNull();
    expect(currentExecutionProof({ ...proof, adapter: "codex-cli" }, binding, now)).toBeNull();
  });
  it("expires without extending itself on reads and refuses future observations", () => {
    expect(currentExecutionProof(proof, binding, now + QUOTA_PROOF_TTL_MS)).toBeNull();
    expect(currentExecutionProof({ ...proof, observedAt: now + 1 }, binding, now)).toBeNull();
    expect(currentExecutionProof({ ...proof, expiresAt: proof.expiresAt + 1 }, binding, now)).toBeNull();
  });
  it("a changed quota generation invalidates success even when its clock is older", () => {
    expect(currentExecutionProof(proof, { ...binding, quotaRevision: "f".repeat(64) }, now)).toBeNull();
  });
  it.each([null, [], {}, { ...proof, version: 2 }, { ...proof, expiresAt: "later" },
    { ...proof, observedAt: NaN }, { ...proof, credentialRevision: "not-a-digest" },
    { ...proof, rawBody: "untrusted" }])("fails closed for malformed or widened payload %j", value => {
    expect(currentExecutionProof(value, binding, now)).toBeNull();
  });
});
