import { describe, expect, it, vi } from "vitest";
import { deterministicExternalTaskRunId, remoteTaskRequestDigest } from "@/lib/mcp-task-capacity-contract";
import type { InitiativeReviewerRecovery } from "@/lib/tak/initiative-readiness-tool-grants";
import { createExhaustedPlanReviewPredicate } from "./exhausted-plan-review";

const authority = { userId: "human", taskAuthorityKey: "oauth-family:one" };
const binding = { writerToolName: "record_initiative_design_review", itemId: "BI-ONE", gate: "plan-review" as const,
  expectedCurrentBaselineId: "baseline-one", workroomRef: { kind: "workroom-head" as const,
    workroomId: "WC-ONE", repositoryFullName: "org/repo", branchName: "fix/one", headSha: "a".repeat(40) },
  artifactRef: { kind: "repo-blob-at-commit" as const, repositoryFullName: "org/repo", commitSha: "b".repeat(40),
    path: "docs/superpowers/plans/one.md", providerBlobId: "c".repeat(40) } };
const packet: InitiativeReviewerRecovery["reviewerRoutes"][number]["requestCoworker"] = {
  targetAgent: "reviewer", objective: "Review exact plan", questionPacketSummary: "plan", requestKey: "exact-key",
  tier: 2, enteredVia: "handoff", requiredToolNames: ["record_initiative_design_review", "read_source_at_version"],
  initiativeReviewBinding: binding,
};
const scope = ["initiative_evidence_write", "backlog-item:BI-ONE", ...packet.requiredToolNames!.map(x => `tool:${x}`)];
const submitted = { agentId: packet.targetAgent, objective: packet.objective, prompt: packet.objective,
  title: packet.questionPacketSummary, idempotencyKey: packet.requestKey, routeContext: "/build",
  riskClass: "bounded-write" as const, collaborationKind: "handoff" as const, authorityScope: scope, initiativeReviewBinding: binding };
function fixture() {
  return { taskRunId: deterministicExternalTaskRunId(authority.taskAuthorityKey, packet.requestKey), userId: "human",
    currentAgentId: "reviewer", status: "input-required", authorityScope: scope,
    a2aMetadata: { taskAuthorityKey: authority.taskAuthorityKey, idempotencyKey: packet.requestKey,
      requestedAgentId: "reviewer", requestDigestVersion: 2, requestDigest: remoteTaskRequestDigest(submitted) },
    progressPayload: { terminalWriterWait: { schemaVersion: 1, kind: "missing-terminal-writer",
      writerToolName: binding.writerToolName, resumeMode: "same-taskrun", dispatchContract: "required-tool-call", attempt: 3, observedAt: "2026-10-12T20:00:00Z" } },
  };
}
describe("exact owned exhausted plan review", () => {
  it.each(["contractless", "typed-uncertainty"])("never offers a replacement for %s execution evidence", async (kind) => {
    const row = fixture();
    if (kind === "contractless") delete (row.progressPayload.terminalWriterWait as Record<string, unknown>).dispatchContract;
    else Object.assign(row.progressPayload, { executionUncertainty: { schemaVersion: 1, settlement: "unknown" } });
    const snapshot = structuredClone(row);
    expect(await createExhaustedPlanReviewPredicate(authority, { taskRun: { findFirst: vi.fn().mockResolvedValue(row) } })(packet)).toBe(false);
    expect(row).toEqual(snapshot);
  });
  it("excludes only the exact owned terminal-exhausted packet", async () => {
    const findFirst = vi.fn().mockResolvedValue(fixture());
    expect(await createExhaustedPlanReviewPredicate(authority, { taskRun: { findFirst } })(packet)).toBe(true);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { taskRunId: fixture().taskRunId, userId: "human" } }));
  });
  it.each(["working", "submitted", "completed", "failed", "canceled", "auth-required"])("does not replace a %s task", async status => {
    expect(await createExhaustedPlanReviewPredicate(authority, { taskRun: { findFirst: vi.fn().mockResolvedValue({ ...fixture(), status }) } })(packet)).toBe(false);
  });
  it.each(["family", "user", "digest", "target", "attempt", "approval", "capacity", "rejection", "uncertain"])("does not exclude from %s mismatch or wait", async kind => {
    const row = fixture();
    if (kind === "family") row.a2aMetadata.taskAuthorityKey = "oauth-family:other";
    if (kind === "user") row.userId = "other";
    if (kind === "digest") row.a2aMetadata.requestDigest = "changed";
    if (kind === "target") row.currentAgentId = "other";
    if (kind === "attempt") row.progressPayload.terminalWriterWait.attempt = 2;
    if (kind === "approval") Object.assign(row.progressPayload, { approvalEnvelopeId: "pending-envelope" });
    if (kind === "capacity") Object.assign(row.progressPayload.terminalWriterWait, { capacityDeferred: "capacity" });
    if (kind === "rejection") Object.assign(row.progressPayload.terminalWriterWait, { writerRejection: { schemaVersion: 1, error: "stale", message: "fix packet", observedAt: "now" } });
    if (kind === "uncertain") row.progressPayload = { executionOutcome: "unknown-provider-outcome", settlement: "unverified" } as never;
    expect(await createExhaustedPlanReviewPredicate(authority, { taskRun: { findFirst: vi.fn().mockResolvedValue(row) } })(packet)).toBe(false);
  });
  it("keeps changed artifact and another authority's task independent", async () => {
    const findFirst = vi.fn().mockResolvedValue(fixture());
    const read = createExhaustedPlanReviewPredicate(authority, { taskRun: { findFirst } });
    expect(await read({ ...packet, initiativeReviewBinding: { ...binding, expectedCurrentBaselineId: "other" } })).toBe(false);
    expect(await createExhaustedPlanReviewPredicate({ ...authority, taskAuthorityKey: "oauth-family:other" }, { taskRun: { findFirst } })(packet)).toBe(false);
  });
  it("does not consult task history without owned authority", async () => {
    const findFirst = vi.fn();
    expect(await createExhaustedPlanReviewPredicate(null, { taskRun: { findFirst } })(packet)).toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
