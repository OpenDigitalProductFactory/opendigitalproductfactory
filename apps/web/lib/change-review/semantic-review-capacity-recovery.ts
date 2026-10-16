import { isRecord } from "@/lib/shared/coerce";
import { LocalProviderCapacityDeferredError } from "@/lib/routing/local-provider-capacity";
import { restoreSemanticReviewCheckpoint } from "./semantic-change-review";
import { SEMANTIC_REVIEW_MAX_ATTEMPTS, isSemanticReviewCapacityReason } from "./semantic-review-recovery-policy";
const record = (value: unknown) => isRecord(value) ? value : {};
const digestPattern = /^[a-f0-9]{64}$/;
const counter = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Only the real direct refusal can attest that this branch never dispatched. */
export function capacityDeferralProof(error: unknown, requestDigest: string, generation: string) {
  return error instanceof LocalProviderCapacityDeferredError && isSemanticReviewCapacityReason(error.reason)
    && digestPattern.test(requestDigest) && generation.length > 0
    ? { schemaVersion: 1, requestDigest, generation, reason: error.reason } : null;
}

type Checkpoint = { taskNodeId: string; status: string; requestContract?: unknown; outputSnapshot?: unknown };
type CheckpointInput = {
  nodes: readonly Checkpoint[]; taskRunId: string; requestDigest: string;
  recoveryAttempt: unknown; specialistIds: readonly string[];
};

function completeCheckpointSet(input: CheckpointInput) {
  const { nodes, taskRunId, requestDigest, recoveryAttempt, specialistIds } = input;
  if (!counter(recoveryAttempt) || recoveryAttempt > SEMANTIC_REVIEW_MAX_ATTEMPTS
    || !digestPattern.test(requestDigest) || !nodes.length || nodes.length > 100 || specialistIds.length > 20) return null;
  const agents = [...new Set(["change-reviewer", ...specialistIds])];
  const expected = new Map<string, string>();
  for (const agent of agents) for (let attempt = 0; attempt <= recoveryAttempt; attempt += 1) {
    expected.set(`semantic-review:${taskRunId}:${agent}${attempt ? `:recovery-${attempt}` : ""}`, agent);
  }
  const active = nodes.filter(node => node.status !== "superseded");
  if (new Set(active.map(node => node.taskNodeId)).size !== active.length) return null;
  if (active.some(node => node.status !== "completed" || !expected.has(node.taskNodeId)
    || record(node.outputSnapshot).requestDigest !== requestDigest
    || record(node.requestContract).requestDigest !== requestDigest
    || record(node.requestContract).agentId !== expected.get(node.taskNodeId))) return null;
  const selected: Array<{ node: Checkpoint; agent: string }> = [];
  for (const agent of agents) {
    let node: Checkpoint | undefined;
    for (let attempt = recoveryAttempt; attempt >= 0 && !node; attempt -= 1) {
      node = active.find(candidate => candidate.taskNodeId === `semantic-review:${taskRunId}:${agent}${attempt ? `:recovery-${attempt}` : ""}`);
    }
    if (!node) return null;
    selected.push({ node, agent });
  }
  return selected;
}

/** Complete verdicts can be republished after loss without another provider invocation. */
export function hasFinalReviewCheckpointSet(input: CheckpointInput): boolean {
  return completeCheckpointSet(input)?.every(({ node, agent }) => {
    const decision = restoreSemanticReviewCheckpoint(record(node.outputSnapshot).result, agent).decision;
    return decision === "pass" || decision === "fail";
  }) ?? false;
}

/** Positive complete-set proof; an absent or unsupported checkpoint is never a retry permit. */
export function hasProvenCapacityCheckpointSet(input: CheckpointInput): boolean {
  const selected = completeCheckpointSet(input);
  if (!selected) return false;
  let deferred = false;
  for (const { node, agent } of selected) {
    const output = record(node.outputSnapshot);
    const result = record(output.result);
    const restored = restoreSemanticReviewCheckpoint(output.result, agent);
    if (restored.decision === "pass") continue;
    const proof = record(output.capacityDeferral);
    const contract = record(node.requestContract);
    if (restored.decision !== "inconclusive" || result.decision !== "inconclusive" || result.inconclusiveReason !== "review-capacity-deferred"
      || !Array.isArray(result.issues) || result.issues.length !== 0
      || output.providerOutcome !== "not-dispatched" || proof.schemaVersion !== 1
      || proof.requestDigest !== input.requestDigest || typeof proof.generation !== "string" || !proof.generation
      || proof.generation !== contract.generation || !isSemanticReviewCapacityReason(proof.reason)) return false;
    deferred = true;
  }
  return deferred;
}

/** Local observation budget, never a new inference deadline or attempt allowance. */
export function capacityRecoveryMarker(requestDigest: string, now: number, checks = 0) {
  return { schemaVersion: 1, requestDigest, checks,
    nextCheckAt: new Date(now + Math.min(30_000 * 2 ** Math.min(checks, 4), 300_000)).toISOString() };
}

