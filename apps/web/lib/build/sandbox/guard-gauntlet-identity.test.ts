import { describe, expect, it } from "vitest";
import { runGuardGauntletIdentity } from "./guard-gauntlet-identity";
import { deriveGauntletGateKey } from "./guard-gauntlet-evidence";
import { evaluatePreflightRequirement } from "../preflight-record-requirement";

// FB-533EC6E2 on 2026-11-13: build/FB-533EC6E2 sits at tree 691d8598 with a
// passing record. The killed readiness run left HEAD detached on the published
// commit, tree 3e2a53ad.
const BRANCH_TREE = "691d859854eadf7d9bb87fc8f08ce9db3f160097";
const PUBLISHED_TREE = "3e2a53adbfa878d2f7897a14eee115743f158903";
const WORKDIR = "/workspace/.builds/FB-533EC6E2";
const REPO = "OpenDigitalProductFactory/opendigitalproductfactory";

/** A sandbox clone that can be detached; a checkout of the build branch reattaches it. */
function leakedClone() {
  const state = { detached: true };
  const exec = async (_id: string, command: string): Promise<string> => {
    if (command.includes("DPF_CHECKOUT=")) {
      if (!state.detached) return "DPF_CHECKOUT=on-branch\n";
      state.detached = false;
      return "DPF_CHECKOUT=restored\n";
    }
    if (command.includes("HEAD^{tree}")) return `${state.detached ? PUBLISHED_TREE : BRANCH_TREE}\n`;
    if (command.includes("node -v")) return "v22.11.0\n9.12.0\n";
    return "";
  };
  return { state, exec };
}

async function identityAndRecord(restoreBranch: string | null) {
  const clone = leakedClone();
  const identity = await runGuardGauntletIdentity({
    containerId: "c1",
    buildId: "FB-533EC6E2",
    repository: REPO,
    exec: clone.exec,
    resolveWorkdir: () => WORKDIR,
    restoreBranch,
  });
  // The record the gauntlet wrote for the build branch's tree.
  const gateKey = deriveGauntletGateKey({
    repository: REPO,
    treeSha: BRANCH_TREE,
    guardPlanDigest: identity.guardPlanDigest!,
    toolchainFingerprint: identity.toolchainFingerprint!,
  });
  const record = { id: "cmw3tna180t5101o2m0ozrj5k", details: { gateKey, status: "passed", evidence: { gateKey, gatePassed: true } } };
  return { identity, result: evaluatePreflightRequirement({ ...identity, records: [record] }) };
}

describe("runGuardGauntletIdentity after a killed readiness run", () => {
  it("without the restore, reads the published tree and the preflight refuses (the live defect)", async () => {
    const { identity, result } = await identityAndRecord(null);
    expect(identity.treeSha).toBe(PUBLISHED_TREE);
    expect(result.blockers[0]).toMatch(/Verification has not passed for this exact change \(3e2a53adbfa8\)/);
  });

  it("puts the clone back on its build branch first, so the build's own passing record matches", async () => {
    const { identity, result } = await identityAndRecord("build/FB-533EC6E2");
    expect(identity.treeSha).toBe(BRANCH_TREE);
    expect(result).toEqual({ blockers: [], evidenceRecordId: "cmw3tna180t5101o2m0ozrj5k", treeSha: BRANCH_TREE });
  });
});
