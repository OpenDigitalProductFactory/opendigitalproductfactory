import { describe, expect, it } from "vitest";
import { buildStageEvidenceBinding, readStageEvidenceBinding } from "./workroom-stage-evidence-binding";

const room = { capsuleId: "WC-ONE", repositoryFullName: "org/repo", headSha: "a".repeat(40),
  scopeClaims: [{ workShape: "delivery-medium@1.0.0" }] };
const evidence = { kind: "pr-gate", stageKey: "implement" };
const payload = () => ({ ...evidence, outcome: "completed", sourceBinding: buildStageEvidenceBinding(room, evidence) });

describe("versioned journal requirement evidence", () => {
  it.each([
    { capsuleId: "WC-OTHER" }, { repositoryFullName: "org/other" }, { headSha: "b".repeat(40) },
    { scopeClaims: [{ workShape: "delivery-large@1.0.0" }] }, { headSha: null },
  ])("does not correlate a different or unresolved current room: %j", change => {
    expect(readStageEvidenceBinding(payload(), { ...room, ...change })).toBeUndefined();
  });
  it.each([
    { version: 2 }, { definitionRef: "delivery-medium@9.0.0" }, { stageKey: "publish" },
    { evidenceKind: "spec-doc" }, { headSha: "invalid" }, { capsuleId: "WC-OTHER" },
  ])("does not accept malformed or mismatched saved identity: %j", change => {
    const saved = payload();
    expect(readStageEvidenceBinding({ ...saved, sourceBinding: { ...saved.sourceBinding, ...change } }, room)).toBeUndefined();
  });
  it("leaves legacy, nested caller results and absent current context unbound", () => {
    expect(readStageEvidenceBinding(evidence, room)).toBeUndefined();
    expect(readStageEvidenceBinding({ ...evidence, result: payload() }, room)).toBeUndefined();
    expect(readStageEvidenceBinding(payload())).toBeUndefined();
  });
  it("does not infer a stage or bind a kind outside its requirement", () => {
    expect(buildStageEvidenceBinding(room, { kind: "pr-gate" })).toBeNull();
    expect(buildStageEvidenceBinding(room, { kind: "spec-doc", stageKey: "implement" })).toBeNull();
  });
  it("retains blocked outcomes as observations without creating a completion verdict", () => {
    expect(readStageEvidenceBinding({ ...payload(), outcome: "blocked" }, room)).toEqual({
      definitionRef: "delivery-medium@1.0.0", stageKey: "implement", evidenceKind: "pr-gate", relationship: "required-evidence" });
  });
});
