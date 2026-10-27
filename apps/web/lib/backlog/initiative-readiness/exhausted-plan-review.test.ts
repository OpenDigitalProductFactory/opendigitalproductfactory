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
  it("reissues an exact owned live legacy packet under its existing key", async () => {
    const scopedBinding = { ...binding, gate: "design-spec" as const };
    const legacy = { ...packet, initiativeReviewBinding: scopedBinding };
    const scoped = { ...legacy, requestKey: `${packet.requestKey}:reviewer:${"c".repeat(64)}` };
    const row = { ...fixture(), status: "working" };
    row.a2aMetadata.requestDigest = remoteTaskRequestDigest({ ...submitted, initiativeReviewBinding: scopedBinding });
    const findFirst = vi.fn(async ({ where }: { where: { taskRunId: string } }) => where.taskRunId === row.taskRunId ? row : null);
    const history = createExhaustedPlanReviewPredicate(authority, { taskRun: { findFirst } });
    expect(await history.resolvePacket(scoped)).toEqual(legacy);
    expect(await history(legacy)).toBe(false);
    row.a2aMetadata.requestDigest = "foreign";
    expect(await history.resolvePacket(scoped)).toEqual(scoped);
  });
  it("retains an alternate's exact exhausted legacy budget and does not fall back behind a live new task", async () => {
    const scopedBinding = { ...binding, gate: "design-spec" as const };
    const legacy = { ...packet, initiativeReviewBinding: scopedBinding };
    const alternate = { ...legacy, requestKey: `${packet.requestKey}:reviewer:${"c".repeat(64)}` };
    const row = fixture();
    row.a2aMetadata.requestDigest = remoteTaskRequestDigest({ ...submitted, initiativeReviewBinding: scopedBinding });
    const findFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(row);
    expect(await createExhaustedPlanReviewPredicate(authority, { taskRun: { findFirst } })(alternate)).toBe(true);
    expect(findFirst).toHaveBeenCalledTimes(2);
    const live = { ...row, taskRunId: deterministicExternalTaskRunId(authority.taskAuthorityKey, alternate.requestKey), status: "working" };
    findFirst.mockReset().mockResolvedValue(live);
    expect(await createExhaustedPlanReviewPredicate(authority, { taskRun: { findFirst } })(alternate)).toBe(false);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
  it.each(["design-spec", "spec-approval", "architecture-review"] as const)("recognizes the exact owned exhausted %s packet", async gate => {
    const scopedBinding = { ...binding, gate,
      writerToolName: gate === "architecture-review" ? "record_initiative_architecture_review" : binding.writerToolName };
    const scopedPacket = { ...packet, initiativeReviewBinding: scopedBinding };
    const row = fixture();
    row.progressPayload.terminalWriterWait.writerToolName = scopedBinding.writerToolName;
    row.authorityScope = scope.map(value => value === `tool:${binding.writerToolName}` ? `tool:${scopedBinding.writerToolName}` : value);
    row.a2aMetadata.requestDigest = remoteTaskRequestDigest({ ...submitted, authorityScope: row.authorityScope, initiativeReviewBinding: scopedBinding });
    expect(await createExhaustedPlanReviewPredicate(authority, { taskRun: { findFirst: vi.fn().mockResolvedValue(row) } })(scopedPacket)).toBe(true);
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

describe("legacy review keys after an OAuth family change", () => {
  const legacy = { ...packet, initiativeReviewBinding: { ...binding, gate: "spec-approval" as const } };
  const scoped = { ...legacy, requestKey: `${packet.requestKey}:reviewer:${"c".repeat(64)}` };
  function original(family = "oauth-family:original") {
    return { ...fixture(), status: "input-required",
      taskRunId: deterministicExternalTaskRunId(family, packet.requestKey),
      a2aMetadata: { ...fixture().a2aMetadata, taskAuthorityKey: family, tokenSource: "oauth",
        initiativeReviewBinding: legacy.initiativeReviewBinding,
        requestDigest: remoteTaskRequestDigest({ ...submitted, initiativeReviewBinding: legacy.initiativeReviewBinding }) },
      progressPayload: { terminalWriterWait: { ...fixture().progressPayload.terminalWriterWait, attempt: 1 } },
    };
  }
  it("keeps the original key for the existing cross-family recovery guard without treating it as exhaustion", async () => {
    const row = original(), before = structuredClone(row);
    const findMany = vi.fn().mockResolvedValue([row]);
    const history = createExhaustedPlanReviewPredicate(authority, { taskRun: {
      findFirst: vi.fn().mockResolvedValue(null), findMany,
    } });
    expect(await history.resolvePacket(scoped)).toEqual(legacy);
    expect(await history(legacy)).toBe(false);
    expect(row).toEqual(before);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: authority.userId }), take: 2,
    }));
  });
  it("keeps an ambiguous original key for the existing original-review-ambiguous refusal", async () => {
    const history = createExhaustedPlanReviewPredicate(authority, { taskRun: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([original(), original("oauth-family:second")]),
    } });
    expect(await history.resolvePacket(scoped)).toEqual(legacy);
  });
  it("does not let a new roster target create a sibling of the same pending immutable review", async () => {
    const changedTarget = { ...scoped, targetAgent: "another-reviewer" };
    const history = createExhaustedPlanReviewPredicate(authority, { taskRun: {
      findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([original()]),
    } });
    // This is only a candidate key. The existing recovery guard must still
    // reject the changed target/digest; it must not miss the original task.
    expect(await history.resolvePacket(changedTarget)).toEqual({ ...changedTarget, requestKey: legacy.requestKey });
  });
  it("never reads older families behind an exact current task", async () => {
    const row = { ...fixture(), taskRunId: deterministicExternalTaskRunId(authority.taskAuthorityKey, scoped.requestKey) };
    const findMany = vi.fn();
    const history = createExhaustedPlanReviewPredicate(authority, { taskRun: {
      findFirst: vi.fn().mockResolvedValue(row), findMany,
    } });
    expect(await history.resolvePacket(scoped)).toEqual(scoped);
    expect(findMany).not.toHaveBeenCalled();
  });
  it.each(["user", "binding", "identity", "source", "terminal"])("does not alias %s history", async kind => {
    const row = original();
    if (kind === "user") row.userId = "another-human";
    if (kind === "binding") row.a2aMetadata.initiativeReviewBinding = { ...legacy.initiativeReviewBinding, expectedCurrentBaselineId: "different" };
    if (kind === "identity") row.taskRunId = "invented";
    if (kind === "source") row.a2aMetadata.tokenSource = "api-token";
    if (kind === "terminal") row.status = "completed";
    const history = createExhaustedPlanReviewPredicate(authority, { taskRun: {
      findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([row]),
    } });
    expect(await history.resolvePacket(scoped)).toEqual(scoped);
  });
});
