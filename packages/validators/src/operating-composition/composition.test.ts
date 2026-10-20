import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildOperatingComposition, COMPOSITION_VERSION, type OperatingComposition } from "./composition.js";
import { importTrustedArtifact } from "../trusted-agent-contracts.js";

export const ref = (id: string, version = "1") => ({ id, version, digest: "sha256:" + "a".repeat(64) });
export const composition = (): OperatingComposition => ({
  schemaVersion: COMPOSITION_VERSION, subjectRef: ref("author"), principalRef: ref("owner"),
  jobRef: ref("software-author"), roleRef: ref("engineer"), supervisionRef: ref("supervision"),
  instructions: [ref("base-prompt"), ref("job-prompt")], skills: [ref("read"), ref("edit")],
  models: [ref("model-binding")], tools: [ref("read-source"), ref("write-proposal")],
  doctrine: [{ scope: "wwmd", profileRef: ref("platform-doctrine") }],
  memoryPolicyRef: ref("governed-memory"), configurationRef: ref("configuration"),
  harnessRef: ref("harness"), runtimeRef: ref("runtime"),
});
export const digest = (text: string) => createHash("sha256").update(text).digest("hex");

describe("versioned operating composition", () => {
  it("produces an exact separate reference and owns an immutable input snapshot", () => {
    const input = composition();
    const result = buildOperatingComposition(input, digest);
    expect(result).toMatchObject({ ok: true, canonicalization: "dpf-canonical-json/v1", compositionRef: {
      id: "operating-composition:author", version: COMPOSITION_VERSION, digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    } });
    if (!result.ok) throw new Error("expected composition");
    input.instructions[0]!.version = "changed";
    expect(result.value.instructions[0]!.version).toBe("1");
  });
  it("normalizes unordered references while preserving ordered instruction meaning", () => {
    const input = composition(), a = buildOperatingComposition(input, digest);
    input.skills.reverse(); input.tools.reverse();
    expect(buildOperatingComposition(input, digest)).toEqual(a);
    input.instructions.reverse();
    expect(buildOperatingComposition(input, digest)).not.toEqual(a);
  });
  it.each(["subjectRef", "principalRef", "jobRef", "roleRef", "supervisionRef", "memoryPolicyRef", "configurationRef", "harnessRef", "runtimeRef"] as const)("binds %s changes", field => {
    const input = composition(), before = buildOperatingComposition(input, digest);
    input[field].version = "2";
    expect(buildOperatingComposition(input, digest)).not.toEqual(before);
  });
  it.each(["instructions", "skills", "models", "tools"] as const)("binds %s content/revision changes", field => {
    const input = composition(), before = buildOperatingComposition(input, digest);
    input[field][0]!.digest = "sha256:" + "b".repeat(64);
    expect(buildOperatingComposition(input, digest)).not.toEqual(before);
  });
  it("binds doctrine revision and owning scope", () => {
    const input = composition(), before = buildOperatingComposition(input, digest);
    input.doctrine[0]!.scope = "wwwd";
    expect(buildOperatingComposition(input, digest)).not.toEqual(before);
  });
  it.each([
    (x: Record<string, unknown>) => { x.schemaVersion = "future"; },
    (x: Record<string, unknown>) => { delete x.supervisionRef; },
    (x: Record<string, unknown>) => { x.authority = "allowed"; },
    (x: Record<string, unknown>) => { x.instructions = []; },
    (x: Record<string, unknown>) => { x.models = [ref("same"), ref("same", "2")]; },
    (x: Record<string, unknown>) => { x.tools = Array.from({ length: 65 }, (_, i) => ref(String(i))); },
    (x: Record<string, unknown>) => { x.runtimeRef = { id: "runtime", version: "1" }; },
    (x: Record<string, unknown>) => { x.doctrine = [{ scope: "other", profileRef: ref("p") }]; },
    (x: Record<string, unknown>) => { x.doctrine = [{ scope: "wwmd", profileRef: ref("p") }, { scope: "wwmd", profileRef: ref("q") }]; },
  ])("holds incomplete, ambiguous or unsupported material", mutate => {
    const input = composition() as unknown as Record<string, unknown>; mutate(input);
    expect(buildOperatingComposition(input, digest).ok).toBe(false);
  });
  it("rejects hostile objects before traversal and digest callbacks", () => {
    let calls = 0; const hash = () => { calls++; return "a".repeat(64); };
    const accessor = Object.defineProperty({}, "schemaVersion", { enumerable: true, get() { throw new Error("read"); } });
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    for (const input of [accessor, cycle, { ...composition(), extra: Infinity }, { ...composition(), extra: "x".repeat(1048577) }]) {
      expect(buildOperatingComposition(input, hash).ok).toBe(false);
    }
    expect(calls).toBe(0);
  });
  it("holds throwing and malformed digest ports", () => {
    for (const port of [() => { throw new Error("unavailable"); }, () => "not-a-digest"])
      expect(buildOperatingComposition(composition(), port).ok).toBe(false);
  });
  it("keeps the generated composition reference inside trusted reference bounds", () => {
    const input = composition(); input.subjectRef.id = "x".repeat(512);
    expect(buildOperatingComposition(input, digest).ok).toBe(false);
  });
  it("fits the existing trusted profile reference field without silently changing its schema", () => {
    const input = composition(), built = buildOperatingComposition(input, digest);
    if (!built.ok) throw new Error("expected valid composition");
    const profile = { schemaVersion: "0.1.0", id: "profile", kind: "operating-profile",
      sourceRef: ref("source"), restrictions: { classificationRef: ref("classification"), accessPolicyRef: ref("access"),
        retentionPolicyRef: ref("retention"), destinationPolicyRef: ref("destination") }, extensions: [],
      subjectRef: input.subjectRef, principalRef: input.principalRef, composition: built.compositionRef,
      instructions: input.instructions, skills: input.skills, models: input.models, tools: input.tools,
      doctrine: input.doctrine, qualifications: [] };
    expect(importTrustedArtifact(profile).ok).toBe(true);
    expect(importTrustedArtifact({ ...profile, supervisionRef: input.supervisionRef }).ok).toBe(false);
  });
});
