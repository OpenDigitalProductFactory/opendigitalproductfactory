import { describe, expect, it } from "vitest";
import { importTrustedArtifact, trustedArtifactJsonSchema } from "./index";

const ref = (id: string) => ({ id, version: "1" });
const privacy = { classificationRef: ref("restricted"), accessPolicyRef: ref("access"), retentionPolicyRef: ref("retention"), destinationPolicyRef: ref("destination") };
const common = { schemaVersion: "0.1.0", id: "test", sourceRef: ref("source"), restrictions: privacy, extensions: [] };
const work = () => ({ ...common, kind: "work-definition", activity: ref("work"), purpose: "Review a simulated change", scope: "wwmd", accountablePrincipalRef: ref("owner"), flow: "sequential", gpp: false, capabilities: [ref("review")], stages: [{ id: "review", consequential: true, capabilityIds: ["review"], next: [], gppBindings: [] }], requiredEvidence: [], limits: { steps: 20, attempts: 2, reconciliations: 3 }, stopConditions: ["cancelled"], reviewConditions: ["budget exhausted"] });
const profile = () => ({ ...common, kind: "operating-profile", subjectRef: ref("agent"), principalRef: ref("owner"), composition: ref("profile"), instructions: [ref("instructions")], skills: [], models: [ref("model")], tools: [ref("review")], doctrine: [{ scope: "wwmd", profileRef: ref("doctrine") }], qualifications: [] });
const decision = () => ({ ...common, kind: "decision", workRef: ref("work"), profileRef: ref("profile"), scope: "wwmd", eligibleOptionIds: ["allowed"], selectedOptionId: "allowed", constraintsSatisfied: true, disposition: "proceed", reasonCodes: ["eligible"], evidence: [] });
const binding = () => ({ effectId: "effect", actorRef: ref("agent"), toolRef: ref("review"), targetRef: ref("resource"), accountRef: ref("account"), argumentDigest: "sha256:" + "a".repeat(64), canonicalization: "RFC8785", purpose: "Review a simulated change", workRef: ref("work"), profileRef: ref("profile"), policyGeneration: "policy-1", gppBindings: [] });
const qualification = () => ({ ...common, kind: "qualification-reference", schemeRef: ref("scheme"), subjectRef: ref("agent"), compositionRef: ref("profile"), status: "scheme-owned-value", evidence: [], assessorRef: ref("assessor"), harnessRef: ref("harness"), validFrom: "2026-01-01T00:00:00Z", validUntil: "2027-01-01T00:00:00Z" });
const receipt = () => ({ ...common, kind: "effect-receipt", decisionRef: ref("decision"), authorizationRef: ref("authorization"), binding: binding(), attemptId: "attempt-1", observation: "unknown", recordedAt: "2026-10-01T00:00:00Z", evidence: [] });

describe("portable trusted-agent contracts (CT-01..04, CT-07)", () => {
  it.each([work, profile, decision, qualification, receipt])("accepts the five bounded artifact kinds", fixture => {
    expect(importTrustedArtifact(fixture())).toMatchObject({ ok: true });
  });
  it("exports structural JSON Schema with the pinned draft and stable id", () => {
    expect(trustedArtifactJsonSchema()).toMatchObject({ $schema: "https://json-schema.org/draft/2020-12/schema", $id: "urn:dpf:trusted-agent:0.1.0" });
  });
  it.each([null, {}, { ...work(), schemaVersion: "2" }, { ...work(), token: "not-allowed" }, { ...work(), restrictions: undefined }])("rejects malformed versions, unknown core fields and missing restrictions", value => {
    expect(importTrustedArtifact(value).ok).toBe(false);
  });
  it("retains optional extensions but requires exact semantic support for mandatory ones", () => {
    const extension = { id: "example:extra", version: "1", mandatory: false, data: { ref: "opaque" } };
    expect(importTrustedArtifact({ ...work(), extensions: [extension] })).toMatchObject({ ok: true, value: { extensions: [extension] } });
    const required = { ...work(), extensions: [{ ...extension, mandatory: true }] };
    expect(importTrustedArtifact(required).ok).toBe(false);
    expect(importTrustedArtifact(required, { extensions: [{ id: extension.id, version: "2", validate: () => true }] }).ok).toBe(false);
    expect(importTrustedArtifact(required, { extensions: [{ id: extension.id, version: "1", validate: () => false }] }).ok).toBe(false);
    expect(importTrustedArtifact(required, { extensions: [{ id: extension.id, version: "1", validate: () => true }] }).ok).toBe(true);
  });
  it("rejects duplicate ids and dangling references", () => {
    const w = work();
    for (const value of [
      { ...w, stages: [...w.stages, ...w.stages] },
      { ...w, stages: [{ ...w.stages[0], next: ["missing"] }] },
      { ...w, stages: [{ ...w.stages[0], capabilityIds: ["missing"] }] },
      { ...w, capabilities: [...w.capabilities, ...w.capabilities] },
      { ...decision(), eligibleOptionIds: ["allowed", "allowed"] },
    ]) expect(importTrustedArtifact(value).ok).toBe(false);
  });
  it("rejects prohibited selections and unresolved waits", () => {
    for (const value of [
      { ...decision(), selectedOptionId: "forbidden" },
      { ...decision(), constraintsSatisfied: false },
      { ...decision(), disposition: "refused" },
      { ...decision(), disposition: "awaiting-person", selectedOptionId: undefined },
    ]) expect(importTrustedArtifact(value).ok).toBe(false);
  });
  it("does not flatten unsupported flow or declare GPP without bindings", () => {
    expect(importTrustedArtifact({ ...work(), flow: "parallel" }).ok).toBe(false);
    expect(importTrustedArtifact({ ...work(), gpp: true }).ok).toBe(false);
  });
  it("requires positive finite bounds and ordered qualification dates", () => {
    for (const steps of [0, -1, NaN, Infinity]) expect(importTrustedArtifact({ ...work(), limits: { ...work().limits, steps } }).ok).toBe(false);
    expect(importTrustedArtifact({ ...qualification(), validUntil: "2025-01-01T00:00:00Z" }).ok).toBe(false);
  });
  it("bounds recursive extension JSON and never throws for cycles or validator exceptions", () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => importTrustedArtifact(cycle)).not.toThrow();
    expect(importTrustedArtifact(cycle).ok).toBe(false);
    let deep: unknown = null; for (let i = 0; i < 40; i++) deep = { nested: deep };
    expect(importTrustedArtifact({ ...work(), extensions: [{ id: "x:deep", version: "1", mandatory: false, data: deep }] }).ok).toBe(false);
    expect(importTrustedArtifact({ ...work(), extensions: [{ id: "x:deep", version: "1", mandatory: true, data: null }] }, { extensions: [{ id: "x:deep", version: "1", validate: () => { throw new Error("bad plugin"); } }] }).ok).toBe(false);
  });
  it("requires evidence for a claim of no effect", () => {
    expect(importTrustedArtifact({ ...receipt(), observation: "no-effect" }).ok).toBe(false);
    expect(importTrustedArtifact({ ...receipt(), observation: "no-effect", evidence: [ref("target-confirmation")] }).ok).toBe(true);
  });
  it("rejects excess collections, sparse JSON, custom array fields and oversized strings", () => {
    const sparse = new Array(3);
    const extra = Object.assign([1], { hiddenMeaning: true });
    for (const data of [sparse, extra, "x".repeat(1048577)]) {
      expect(importTrustedArtifact({ ...work(), extensions: [{ id: "x:test", version: "1", mandatory: false, data }] }).ok).toBe(false);
    }
    expect(importTrustedArtifact({ ...work(), id: "x".repeat(513) }).ok).toBe(false);
    expect(importTrustedArtifact({ ...work(), capabilities: Array.from({ length: 65 }, (_, i) => ref(String(i))) }).ok).toBe(false);
  });
  it("preserves all restrictions through JSON round-trip and checks expiry", () => {
    const value = { ...work(), restrictions: { ...privacy, expiresAt: "2026-10-01T00:00:00Z" } };
    expect(importTrustedArtifact(JSON.parse(JSON.stringify(value)))).toMatchObject({ ok: true, value: { restrictions: value.restrictions } });
    expect(importTrustedArtifact(value, { now: "2026-10-01T00:00:00Z" }).ok).toBe(false);
  });

});
