import { describe, expect, it } from "vitest";

import { createReassessmentCandidateProver, reassessmentThroughPrivateActuator } from "./reassessment-candidate-actuator";
import type { VerifiedReleaseTargetEvidence } from "@/lib/release-health/state";
import type { ReassessmentRuntimeCompatibility } from "@/lib/shared/reassessment-owner-versions";
import { reassessmentRefusalDetail } from "@/lib/mcp-task-reassessment-contract";

const refusal = async (promise: Promise<unknown>) => {
  try { await promise; } catch (error) { return reassessmentRefusalDetail(error); }
  throw new Error("expected a refusal");
};

const runId = "SUR-REASSESS1";
const targetSha = "a".repeat(40);
const candidate = { tag: "v2026.11.25-release.1", sourceSha: targetSha, channelDigest: `sha256:${"1".repeat(64)}`,
  platformManifestDigest: `sha256:${"2".repeat(64)}`, configDigest: `sha256:${"3".repeat(64)}`, platformOs: "linux" as const, platformArchitecture: "amd64" };
const evidence = { ghcrOwner: "OpenDigitalProductFactory", candidate } as unknown as VerifiedReleaseTargetEvidence;
const proof = { marker: "proof" } as unknown as ReassessmentRuntimeCompatibility;
const request = (input: Record<string, unknown> = {}) => ({ owner: { kind: "self-upgrade", runId }, input: { targetSha, release: false, ...input } });

function harness(options: { run?: { status: string; deployedSha: string | null } | null; evidence?: VerifiedReleaseTargetEvidence | null } = {}) {
  const proved: unknown[] = [];
  const prove = createReassessmentCandidateProver({
    project: "dpf",
    readRun: async () => (options.run === undefined ? { status: "running", deployedSha: targetSha } : options.run),
    readVerifiedRelease: async () => (options.evidence === undefined ? evidence : options.evidence),
    prove: async (input) => { proved.push(input); return proof; },
  });
  return { prove, proved };
}

describe("createReassessmentCandidateProver", () => {
  it("proves the install's own built portal for a source run", async () => {
    const h = harness();
    await expect(h.prove(request())).resolves.toBe(proof);
    expect(h.proved).toEqual([{ targetSha, composeProject: "dpf" }]);
  });

  it("proves the verified release for exactly this target, with the identity it derived", async () => {
    const h = harness();
    await h.prove(request({ release: true }));
    const { sourceSha: _sourceSha, ...identity } = candidate;
    void _sourceSha;
    expect(h.proved).toEqual([{ targetSha, composeProject: "dpf", release: { ...identity, ghcrOwner: "opendigitalproductfactory" } }]);
  });

  it.each([
    ["a settled run", { run: { status: "failed", deployedSha: targetSha } }, {}],
    ["a target the run does not expect", { run: { status: "running", deployedSha: "f".repeat(40) } }, {}],
    ["a release run without fresh evidence", { evidence: null }, { release: true }],
    ["a release for another commit", { evidence: { ...evidence, candidate: { ...candidate, sourceSha: "f".repeat(40) } } }, { release: true }],
    ["a caller-chosen image", {}, { image: "attacker/portal" }],
  ])("refuses %s before any probe", async (_label, options, input) => {
    const h = harness(options as never);
    await expect(h.prove(request(input))).rejects.toThrow("reassessment_candidate_admission_refused");
    expect(h.proved).toHaveLength(0);
  });
});

describe("reassessmentThroughPrivateActuator", () => {
  it("stays local without the actuator and turns a lost reply into a refusal", async () => {
    await expect(reassessmentThroughPrivateActuator({ runId, targetSha, release: false }, async () => false, async () => proof)).resolves.toBeNull();
    expect(await refusal(reassessmentThroughPrivateActuator({ runId, targetSha, release: false }, async () => true, async () => { throw new Error("lost"); })))
      .toBe("actuator-proof-unavailable");
    expect(await refusal(reassessmentThroughPrivateActuator({ runId, targetSha, release: false }, async () => true, async () => ({ not: "a proof" }))))
      .toBe("actuator-proof-invalid");
  });
});
