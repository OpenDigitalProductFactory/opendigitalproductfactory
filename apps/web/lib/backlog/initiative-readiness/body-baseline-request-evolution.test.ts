import { describe, expect, it } from "vitest";
import { classifyHistoricalObjectiveMappingArtifacts } from "./objective-mapping-history-artifacts";
import { authorizeObjectiveMappingRequestKeyEvolution, createObjectiveMappingRequestKey, type ObjectiveMappingRequestHistory } from "@/lib/mcp-task-objective-mapping-request-key";
const source = { kind: "workroom-head" as const, workroomId: "WC-CASE", repositoryFullName: "owner/repo", branchName: "fix/case", headSha: "a".repeat(40) };
const ref = (versionId: string) => ({ kind: "document-version" as const, repositoryFullName: "owner/repo", versionId, valueDigest: `sha256:${versionId}` });
function packet(versionId: string, baselineId: string, evidence = ["E-1"]) {
  const draft = { targetAgent: "AGT-REVIEW", questionPacketSummary: "objective-mapping for BI-CASE", objective: `Review criteria version ${versionId} with evidence ${evidence.join(",")}`,
    requiredToolNames: ["record_initiative_evidence", "read_source_at_version"],
    binding: { writerToolName: "record_initiative_evidence", itemId: "BI-CASE", gate: "objective-mapping" as const,
      expectedCurrentBaselineId: baselineId, eligibleEvidenceActivityIds: evidence, workroomRef: source, artifactRef: ref(versionId) } };
  return { ...draft, requestKey: createObjectiveMappingRequestKey(draft) };
}
const oldPacket = packet("version-1", "baseline-1");
const prior: ObjectiveMappingRequestHistory = { taskRunId: "TR-OLD", status: "working", targetAgent: oldPacket.targetAgent,
  objective: oldPacket.objective, questionPacketSummary: oldPacket.questionPacketSummary, idempotencyKey: oldPacket.requestKey,
  requiredToolNames: oldPacket.requiredToolNames, binding: oldPacket.binding, actionEnvelopeStatuses: ["approved"], writerExecutions: [] };
async function proofs(next: ReturnType<typeof packet>, history = prior) {
  const first = { baselineId: "baseline-1", supersedesBaselineId: null, origin: "item-body", artifactRef: ref("version-1") };
  const current = next.binding.expectedCurrentBaselineId === "baseline-1" ? first
    : { baselineId: "baseline-2", supersedesBaselineId: "baseline-1", origin: "item-body", artifactRef: ref("version-2") };
  const classified = await classifyHistoricalObjectiveMappingArtifacts({ history: [history], baselineRows: current === first ? [first] : [first, current], currentBaseline: current,
    currentArtifact: { repositoryFullName: "owner/repo", path: `initiative-body-version/${next.binding.artifactRef.versionId}` },
    currentEvidenceActivityIds: next.binding.eligibleEvidenceActivityIds, room: { capsuleId: source.workroomId, backlogItemId: "BI-CASE",
      repositoryFullName: source.repositoryFullName, headSha: source.headSha, headBranch: source.branchName, baseSha: "b".repeat(40), isLive: true },
    verify: async () => { throw new Error("Body proof must not impersonate repository-provider proof"); } });
  if (!classified.ok) throw new Error(classified.error);
  return classified.data.serverProvenStaleBodyTaskRunProofs;
}
describe("server-proven body acceptance invalidation", () => {
  it("keeps exact unchanged retries idempotent, and does not churn active current authority", async () => {
    expect(authorizeObjectiveMappingRequestKeyEvolution({ packet: oldPacket, history: [prior] })).toEqual({ authorized: true });
    const different = { ...oldPacket, targetAgent: "AGT-OTHER" };
    expect(authorizeObjectiveMappingRequestKeyEvolution({ packet: { ...different, requestKey: createObjectiveMappingRequestKey(different) }, history: [prior] }).authorized).toBe(false);
    expect((await proofs(oldPacket)).size).toBe(0);
  });
  it.each([packet("version-2", "baseline-2"), packet("version-1", "baseline-1", ["E-1", "E-2"])])("permits only a fresh current request after proven criteria/evidence invalidation", async (next) => {
    expect(authorizeObjectiveMappingRequestKeyEvolution({ packet: next, history: [prior] }).authorized).toBe(false);
    expect(authorizeObjectiveMappingRequestKeyEvolution({ packet: next, history: [prior], serverProvenStaleBodyTaskRunProofs: await proofs(next) })).toEqual({ authorized: true });
  });
  it("never turns invalidation into a different-item or forged-packet approval", async () => {
    const next = packet("version-2", "baseline-2");
    const proof = await proofs(next);
    const wrong = { ...next, binding: { ...next.binding, itemId: "BI-OTHER" } };
    expect(authorizeObjectiveMappingRequestKeyEvolution({ packet: { ...wrong, requestKey: createObjectiveMappingRequestKey(wrong) }, history: [prior], serverProvenStaleBodyTaskRunProofs: proof }).authorized).toBe(false);
    expect(authorizeObjectiveMappingRequestKeyEvolution({ packet: { ...next, requestKey: "caller-key" }, history: [prior], serverProvenStaleBodyTaskRunProofs: proof }).authorized).toBe(false);
  });
});
