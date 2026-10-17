import { describe, expect, it } from "vitest";
import { LocalProviderCapacityDeferredError } from "@/lib/routing/local-provider-capacity";
import { capacityDeferralProof, capacityRecoveryMarker, hasProvenCapacityCheckpointSet, hasFinalReviewCheckpointSet } from "./semantic-review-capacity-recovery";
import { readCapacityRecoveryWait, semanticReviewRecoveryObservation } from "./semantic-review-recovery-policy";

const digest = "a".repeat(64);
const now = Date.parse("2026-10-16T06:00:00Z");
const pass = { decision: "pass", issues: [], summary: "Reviewed exact source.",
  failureAnalysisReview: { adequate: true, rationale: "Challenged failure and recovery evidence." } };
function deferred(agent = "change-reviewer", attempt = 0) {
  return { taskNodeId: `semantic-review:TR-1:${agent}${attempt ? `:recovery-${attempt}` : ""}`, status: "completed",
    requestContract: { requestDigest: digest, agentId: agent, generation: "generation-1" },
    outputSnapshot: { requestDigest: digest, providerOutcome: "not-dispatched",
      capacityDeferral: capacityDeferralProof(new LocalProviderCapacityDeferredError("local-runner-busy"), digest, "generation-1"),
      result: { decision: "inconclusive", issues: [], summary: "Capacity unavailable before dispatch.", inconclusiveReason: "review-capacity-deferred" } as Record<string, unknown> },
  };
}
const prove = (nodes: ReturnType<typeof deferred>[], specialistIds: string[] = [], recoveryAttempt: unknown = 0) =>
  hasProvenCapacityCheckpointSet({ nodes, taskRunId: "TR-1", requestDigest: digest, recoveryAttempt, specialistIds });

describe("positive pre-dispatch capacity proof", () => {
  it("accepts the real direct refusal and rejects names, wrappers, model strings and unsupported values", () => {
    const error = new LocalProviderCapacityDeferredError("local-runner-busy");
    expect(capacityDeferralProof(error, digest, "generation-1")).toMatchObject({ schemaVersion: 1, requestDigest: digest });
    for (const candidate of [Object.assign(new Error("capacity"), { name: error.name }),
      new Error("fallback failed", { cause: error }), String(error), null]) {
      expect(capacityDeferralProof(candidate, digest, "generation-1")).toBeNull();
    }
    expect(capacityDeferralProof(error, "missing", "generation-1")).toBeNull();
  });

  it("requires the complete branch set while preserving valid passing siblings", () => {
    const sibling = deferred("AGT-903");
    const nodes = [deferred(), { ...sibling, outputSnapshot: { ...sibling.outputSnapshot, result: pass } }];
    expect(prove(nodes, ["AGT-903"])).toBe(true);
    expect(prove([deferred()], ["AGT-903"])).toBe(false);
    expect(prove([{ ...deferred(), outputSnapshot: { ...deferred().outputSnapshot, result: pass } }])).toBe(false);
  });

  it.each(["running", "failed", "unknown", "foreign", "proof", "generation", "result", "request", "duplicate"])(
    "rejects %s checkpoint uncertainty rather than replaying", failure => {
      const node = deferred();
      if (["running", "failed", "unknown"].includes(failure)) node.status = failure;
      if (failure === "foreign") node.taskNodeId = "semantic-review:TR-OTHER:change-reviewer";
      if (failure === "proof") node.outputSnapshot.capacityDeferral = null;
      if (failure === "generation") node.requestContract.generation = "other-generation";
      if (failure === "result") node.outputSnapshot.result.decision = "fail";
      if (failure === "request") node.outputSnapshot.requestDigest = "b".repeat(64);
      expect(prove(failure === "duplicate" ? [node, node] : [node])).toBe(false);
    },
  );

  it("bounds generations and refuses absent, excessive or corrupt checkpoints", () => {
    expect(prove([])).toBe(false);
    expect(prove(Array.from({ length: 101 }, () => deferred()))).toBe(false);
    for (const attempt of [-1, 4, NaN, "0", null]) expect(prove([deferred()], [], attempt)).toBe(false);
    const old = { ...deferred(), status: "superseded" };
    expect(prove([old, deferred("change-reviewer", 1)], [], 1)).toBe(true);
  });

  it("permits final-verdict publication but rejects inconclusive checkpoints as provider-free recovery", () => {
    const input = { nodes: [deferred()], taskRunId: "TR-1", requestDigest: digest, recoveryAttempt: 0, specialistIds: [] };
    expect(hasFinalReviewCheckpointSet(input)).toBe(false);
    input.nodes[0]!.outputSnapshot.result = pass;
    expect(hasFinalReviewCheckpointSet(input)).toBe(true);
    input.nodes[0]!.outputSnapshot.result = { ...pass, decision: "fail" };
    expect(hasFinalReviewCheckpointSet(input)).toBe(true);
    input.nodes[0]!.status = "running";
    expect(hasFinalReviewCheckpointSet(input)).toBe(false);
  });
});

describe("bounded recovery observation", () => {
  const state = (marker = capacityRecoveryMarker(digest, now)) => ({ schemaVersion: 1,
    requestDigest: digest, reason: "review-capacity-deferred", deadlineAt: new Date(now + 30 * 60_000).toISOString(), capacityRecovery: marker });

  it("backs off without extending the inference budget and exposes server-owned progress", () => {
    const first = capacityRecoveryMarker(digest, now);
    const later = capacityRecoveryMarker(digest, now, 10);
    expect(Date.parse(first.nextCheckAt) - now).toBe(30_000);
    expect(Date.parse(later.nextCheckAt) - now).toBe(300_000);
    const observation = semanticReviewRecoveryObservation("input-required", { semanticReview: state() }, now);
    expect(observation).toMatchObject({ classification: "capacity-wait", pollUseful: true, remainingAttempts: 3 });
    expect(observation.nextAction).toContain("server will recheck");
    expect(semanticReviewRecoveryObservation("completed", { semanticReview: state() }, now).classification).toBe("completed");
    expect(semanticReviewRecoveryObservation("input-required", { semanticReview: state() }, now + 31 * 60_000).capacityRecovery).toBeNull();
  });

  it.each(["legacy", "foreign", "unknown", "eligibility", "counter", "version", "date"])(
    "does not project %s state as automatic authority", failure => {
      const progress: Record<string, unknown> = state();
      if (failure === "legacy") delete progress.capacityRecovery;
      if (failure === "foreign") progress.requestDigest = "b".repeat(64);
      if (failure === "unknown") progress.executionOutcome = "unknown";
      if (failure === "eligibility") progress.routingEligibility = [{}];
      if (failure === "counter") progress.capacityRecovery = { ...capacityRecoveryMarker(digest, now), checks: -1 };
      if (failure === "version") progress.capacityRecovery = { ...capacityRecoveryMarker(digest, now), schemaVersion: 2 };
      if (failure === "date") progress.capacityRecovery = { ...capacityRecoveryMarker(digest, now), nextCheckAt: "unknown" };
      expect(readCapacityRecoveryWait(progress)).toBeNull();
    },
  );
});
