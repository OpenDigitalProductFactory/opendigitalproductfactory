import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { buildOperatingComposition, COMPOSITION_VERSION, type OperatingComposition } from "./composition.js";
import { queryOperatingQualification, QUALIFICATION_FACT_VERSION, type QualificationFacts } from "./qualification.js";

const ref = (id: string) => ({ id, version: "1", digest: "sha256:" + "a".repeat(64) });
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const composition = (): OperatingComposition => ({ schemaVersion: COMPOSITION_VERSION,
  subjectRef: ref("author"), principalRef: ref("owner"), jobRef: ref("author-job"), roleRef: ref("engineer"),
  supervisionRef: ref("supervision"), instructions: [ref("prompt")], skills: [], models: [ref("model")], tools: [],
  doctrine: [{ scope: "wwmd", profileRef: ref("doctrine") }], memoryPolicyRef: ref("memory-policy"),
  configurationRef: ref("config"), harnessRef: ref("harness"), runtimeRef: ref("runtime") });
const fixture = () => {
  const input = composition(), built = buildOperatingComposition(input, digest);
  if (!built.ok) throw new Error("fixture composition");
  const current = { status: "current", subjectRef: input.subjectRef, principalRef: input.principalRef, compositionRef: built.compositionRef };
  const facts: QualificationFacts = JSON.parse(JSON.stringify({ schemaVersion: QUALIFICATION_FACT_VERSION, reference: ref("qualification"),
    subjectRef: input.subjectRef, principalRef: input.principalRef, compositionRef: built.compositionRef,
    schemeRef: ref("author-scheme"), harnessRef: input.harnessRef, runtimeRef: input.runtimeRef,
    assessorRef: ref("independent-assessor"), status: "qualified", evidence: [ref("assessment")],
    validFrom: "2026-10-19T00:00:00Z", validUntil: "2026-10-21T00:00:00Z" }));
  const query = { schemeRef: facts.schemeRef, now: "2026-10-20T00:00:00Z" };
  return { input, current, facts, query, ports: { digest, readCurrentComposition: async () => current,
    readQualification: async () => facts } };
};
describe("exact composition qualification facts, never admission", () => {
  it("queries supplied current exact-subject evidence with no authority effects", async () => {
    const f = fixture();
    expect(await queryOperatingQualification(f.input, f.query, f.ports)).toMatchObject({ status: "qualified", authority: "assessment-only", qualificationRef: f.facts.reference });
  });
  it.each(["subjectRef", "principalRef", "compositionRef", "schemeRef", "harnessRef", "runtimeRef"] as const)("holds mismatched %s", async key => {
    const f = fixture(); f.facts[key] = ref("wrong");
    expect((await queryOperatingQualification(f.input, f.query, f.ports)).status).toBe("held");
  });
  it.each(["revoked", "failed", "unknown", "not-applicable"])("holds %s instead of fabricating qualification", async status => {
    const f = fixture(); Object.assign(f.facts, { status });
    expect((await queryOperatingQualification(f.input, f.query, f.ports)).status).toBe("held");
  });
  it("requeries revocation even after a prior qualified observation", async () => {
    const f = fixture();
    expect((await queryOperatingQualification(f.input, f.query, f.ports)).status).toBe("qualified");
    f.current.status = "revoked";
    expect((await queryOperatingQualification(f.input, f.query, f.ports)).status).toBe("held");
  });
  it("holds a composition revoked during the fact read", async () => {
    const f = fixture(); f.ports.readQualification = async () => { f.current.status = "revoked"; return f.facts; };
    expect((await queryOperatingQualification(f.input, f.query, f.ports)).status).toBe("held");
  });
  it.each(["2026-10-18T00:00:00Z", "2026-10-21T00:00:00Z", "invalid"])("holds invalid qualification window at %s", async now => {
    const f = fixture(); f.query.now = now;
    expect((await queryOperatingQualification(f.input, f.query, f.ports)).status).toBe("held");
  });
  it.each([null, {}, { status: "qualified" }])("holds absent or unsupported host facts", async value => {
    const f = fixture();
    expect((await queryOperatingQualification(f.input, f.query, { ...f.ports, readQualification: async () => value })).status).toBe("held");
  });
  it("holds missing evidence and unavailable current/fact ports", async () => {
    const f = fixture(); f.facts.evidence = [];
    expect((await queryOperatingQualification(f.input, f.query, f.ports)).status).toBe("held");
    for (const key of ["readCurrentComposition", "readQualification"] as const) {
      expect((await queryOperatingQualification(f.input, f.query, { ...f.ports, [key]: async () => { throw new Error("offline"); } })).status).toBe("held");
    }
  });
  it("does not pass caller-owned mutable input into async host queries", async () => {
    const f = fixture();
    f.ports.readQualification = async () => { f.input.runtimeRef.version = "tampered"; return f.facts; };
    expect((await queryOperatingQualification(f.input, f.query, f.ports)).status).toBe("qualified");
  });
  it.each([null, {}, { status: "not-applicable" }])("holds missing current composition facts", async value => {
    const f = fixture();
    expect((await queryOperatingQualification(f.input, f.query, { ...f.ports, readCurrentComposition: async () => value })).status).toBe("held");
  });
  it("holds a wrong current revision and unsupported qualification version", async () => {
    const f = fixture(); f.current.compositionRef = ref("different");
    expect((await queryOperatingQualification(f.input, f.query, f.ports)).status).toBe("held");
    const g = fixture(); Object.assign(g.facts, { schemaVersion: "future" });
    expect((await queryOperatingQualification(g.input, g.query, g.ports)).status).toBe("held");
  });
  it("rejects impossible observation dates instead of JavaScript date normalization", async () => {
    const f = fixture(); f.query.now = "2026-02-30T00:00:00Z";
    f.facts.validFrom = "2026-01-01T00:00:00Z"; f.facts.validUntil = "2026-12-31T00:00:00Z";
    expect((await queryOperatingQualification(f.input, f.query, f.ports)).status).toBe("held");
  });
});
