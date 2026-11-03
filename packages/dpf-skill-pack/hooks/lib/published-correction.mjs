// Publication eligibility only. This never establishes local integration PASS.
import { createHash } from "node:crypto";
import { classifyLocalCiOverride, classifyGateInfrastructureEvidence, GATE_INFRASTRUCTURE_UNAVAILABLE_CODE, PUBLISHED_CORRECTION_CODE } from "./local-ci-override.mjs";

const SHA = /^[a-f0-9]{40}$/;
export const CORRECTION_TTL_MS = 60 * 60_000;
export const CORRECTION_POLICY = "published-correction-v1";
export const correctionPlanDigest = commands => createHash("sha256").update(JSON.stringify(commands)).digest("hex");
const miss = reason => ({ ok: false, reason: `Published correction unresolved: ${reason}` });

/** Qualify the historical initial-publication record at its actual capture time. */
export function classifyInitialPublication(anchor, { repositoryFullName, branch, pullRequestNumber } = {}) {
  if (!anchor || anchor.repositoryFullName !== repositoryFullName || anchor.branch !== branch
    || anchor.pullRequestNumber !== pullRequestNumber || !SHA.test(anchor.sha ?? "") || !SHA.test(anchor.tree ?? "")) return miss("missing or foreign initial-publication anchor");
  const state = anchor.state;
  const metadata = anchor.metadata;
  const equivalent = anchor.equivalentCandidate;
  const sameSynthesizedTree = equivalent?.sha === state?.sha
    && equivalent?.synthesizedTreeSha === anchor.tree
    && metadata?.candidateSha === state?.sha
    && metadata?.synthesizedTreeSha === anchor.tree;
  const capturedAt = Date.parse(anchor.capturedAt);
  if (!state || state.branch !== branch || (state.sha !== anchor.sha && !sameSynthesizedTree) || !Number.isFinite(capturedAt)
    || !Number.isFinite(Date.parse(state.recordedAt)) || Date.parse(state.recordedAt) > capturedAt
    || state.testStub === true || state.evidencePending === true) return miss("initial publication was not qualified at capture");
  if (state.gatePassed === true && state.status === "passed" && !state.skipped) {
    // A signed/rebased PR commit may retain exactly the same synthesized
    // integration tree as the canonical candidate that was executed.  The
    // evidence remains bound to its original candidate SHA; accept it for the
    // published SHA only when that full integration tree is identical.
    const candidateMatches = state.sha === anchor.sha || sameSynthesizedTree;
    if (!state.evidenceRecordId || !(Date.parse(state.expiresAt) > capturedAt)
      || !state.leaseId || metadata?.candidateSha !== state.sha || !candidateMatches || metadata.runLeaseId !== state.leaseId
      || metadata.execution?.status !== "passed") return miss("initial canonical evidence is unbound or unqualified");
    return { ok: true, kind: "canonical" };
  }
  const override = classifyLocalCiOverride(state.skipReason);
  if (state.gatePassed !== false || state.skipped !== true || !override.ok
    || override.code === PUBLISHED_CORRECTION_CODE) return miss("a correction cannot mint its own initial-publication anchor");
  if (override.code === GATE_INFRASTRUCTURE_UNAVAILABLE_CODE && !classifyGateInfrastructureEvidence(state.infrastructureEvidence).ok) return miss("initial infrastructure override has no machine evidence");
  return { ok: true, kind: "override" };
}

/** Shared by the installed hook, readiness and PR health. Prose is insufficient. */
export function classifyPublishedCorrection(state, { sha, branch, repositoryFullName, tree, now = Date.now(), expectedPlanDigest } = {}) {
  const proof = state?.publicationCorrection;
  if (state?.gatePassed !== false || state.skipped !== true || state.status !== "gate-unrun"
    || classifyLocalCiOverride(state.skipReason).code !== PUBLISHED_CORRECTION_CODE
    || proof?.schemaVersion !== 1) return miss("no machine-bound current-head proof");
  if (!SHA.test(proof.sha ?? "") || !SHA.test(proof.tree ?? "") || !proof.repositoryFullName
    || state.sha !== proof.sha || state.branch !== proof.branch
    || (sha && proof.sha !== sha) || (branch && proof.branch !== branch)
    || (tree && proof.tree !== tree) || (repositoryFullName && proof.repositoryFullName !== repositoryFullName)) return miss("source or repository identity differs");
  const completed = Date.parse(proof.completedAt), expires = Date.parse(proof.expiresAt);
  if (!Number.isFinite(completed) || completed > now || !Number.isFinite(expires)
    || expires <= now || expires - completed > CORRECTION_TTL_MS || expires <= completed
    || state.expiresAt !== proof.expiresAt) return miss("proof is expired or has invalid freshness");
  const pr = proof.pullRequest;
  if (!Number.isSafeInteger(pr?.number) || pr.number <= 0 || pr.state !== "OPEN" || pr.isDraft !== false
    || pr.baseRefName !== "main" || pr.headRefName !== proof.branch
    || !SHA.test(pr.headRefOid ?? "") || pr.repositoryFullName !== proof.repositoryFullName) return miss("no matching open published PR");
  const protection = proof.protection;
  const observed = Date.parse(protection?.observedAt);
  if (protection?.repositoryFullName !== proof.repositoryFullName || protection.branch !== "main"
    || protection.mergeQueue !== true || !Array.isArray(protection.requiredChecks)
    || !protection.requiredChecks.length || protection.requiredChecks.some(check => typeof check !== "string" || !check.trim())
    || !Number.isFinite(observed) || observed > completed || completed - observed > CORRECTION_TTL_MS) return miss("protected checks and merge queue were not verified");
  const anchor = classifyInitialPublication(proof.anchor, { repositoryFullName: proof.repositoryFullName, branch: proof.branch, pullRequestNumber: pr.number });
  if (!anchor.ok) return anchor;
  if (!Array.isArray(proof.commands) || !Array.isArray(proof.results)
    || proof.commands.length !== proof.results.length
    || proof.commands.some(entry => typeof entry.command !== "string" || !entry.command || !Array.isArray(entry.args) || entry.args.some(arg => typeof arg !== "string"))
    || proof.results.some(result => result.exitCode !== 0 || result.outcome || result.skipped === true)) return miss("affected checks failed, skipped or did not finish");
  if (!Array.isArray(proof.changedFiles) || !["unchanged-head", "commit-metadata", "main-refresh", "authored-correction"].includes(proof.classification)
    || ((proof.changedFiles.length > 0 || proof.tree !== proof.anchor.tree) && proof.commands.length === 0)
    || (["unchanged-head", "commit-metadata"].includes(proof.classification) && proof.tree !== proof.anchor.tree)
    || (proof.classification === "unchanged-head" && proof.sha !== proof.anchor.sha)) return miss("changed source lacks an executed affected plan");
  const identity = proof.identity;
  if (identity?.policy !== CORRECTION_POLICY || identity.head !== proof.sha || identity.tree !== proof.tree
    || identity.branch !== proof.branch || !identity.toolchain || !identity.environment
    || identity.plan !== proof.planDigest || proof.planDigest !== correctionPlanDigest(proof.commands)
    || (expectedPlanDigest && expectedPlanDigest !== proof.planDigest)) return miss("policy, toolchain or expected check plan differs");
  if (!["full-local-integration", "protected-github-checks", "merge-queue"].every(kind => proof.delegated?.includes(kind))) return miss("integration delegation is incomplete");
  return { ok: true, kind: "published-correction", reason: "Local integration UNRUN; affected checks executed, full integration delegated to protected GitHub checks and merge queue.", proof };
}
