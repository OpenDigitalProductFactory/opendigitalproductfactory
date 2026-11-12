import { describe, expect, it, vi } from "vitest";
import { boundReviewReceiptId, checkBoundReviewWriteExecution, lockBoundReviewEffect, publishBoundReviewEffect, type BoundReviewScope } from "./bound-review-effect";
import { captureTaskExecutionFence } from "@/lib/shared/task-execution-fence";
import type { Prisma } from "@dpf/db";

it("locks the task before both sorted reassessment owners without checking new-write authority during receipt readback", async () => {
  const requestDigest = "9".repeat(64);
  const scope: BoundReviewScope = { actionKey: "record_initiative_design_review", itemId: "BI-285EF102", gate: "design-spec",
    artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "fixture/repo", commitSha: "a".repeat(40), providerBlobId: "b".repeat(40), path: "design.md" },
    reviewerUserId: "reviewer", reviewerAgentId: "AGT-REVIEW", authorityDecisionId: "AUTH-1", expectedCurrentBaselineId: null,
    boundReviewTask: { taskRunId: "TR-PRESENT", requestDigest, executionFence: captureTaskExecutionFence({}, requestDigest)! } };
  const presentReassessment = { schemaVersion: 1, authorizationItemId: "BI-7906C73E", baselineId: "baseline-fixture", policyDigest: "2".repeat(64),
    originalTaskRunId: "TR-OLD", originalRequestDigest: "3".repeat(64), predecessorTaskRunIds: ["TR-OLD"], authorityArtifact: scope.artifactRef };
  const binding = { writerToolName: scope.actionKey, itemId: scope.itemId, gate: scope.gate, artifactRef: scope.artifactRef,
    expectedCurrentBaselineId: null, presentReassessment };
  const tx = { $queryRaw: vi.fn(async (..._args: unknown[]) => []),
    taskRun: { findUnique: vi.fn(async () => ({ userId: scope.reviewerUserId, currentAgentId: scope.reviewerAgentId, status: "working",
      progressPayload: { reassessmentQuarantine: { retained: true } }, a2aMetadata: { trigger: "external-mcp", requestDigest, initiativeReviewBinding: binding,
        reassessmentExecution: { schemaVersion: 2, manifestArtifactId: "ta-root", manifestDigest: "4".repeat(64) } } })) },
    authorizationDecisionLog: { findUnique: vi.fn(async () => ({ decision: "allow", actionKey: scope.actionKey, organizationId: null,
      rationale: { taskRunId: scope.boundReviewTask!.taskRunId } })) },
    coworkerActionEnvelope: { findMany: vi.fn(async () => []) },
    backlogItem: { findMany: vi.fn(async () => [{ id: "row-z", itemId: scope.itemId, organizationId: null },
      { id: "row-a", itemId: presentReassessment.authorizationItemId, organizationId: null }]) } };
  const locked = await lockBoundReviewEffect(tx as unknown as Prisma.TransactionClient, scope, null);
  expect(locked.refusal).toBeNull();
  expect(tx.$queryRaw.mock.calls.map(call => call[1])).toEqual(["TR-PRESENT", "row-a", "row-z"]);
  expect(await checkBoundReviewWriteExecution(scope, locked.execution, tx as unknown as Prisma.TransactionClient))
    .toMatchObject({ ok: false, code: "AUTHORIZATION_DENIED" });
});

it("refuses a new V2 writer effect without the actual promoted server scope", async () => {
  const requestDigest = "9".repeat(64);
  const scope: BoundReviewScope = { actionKey: "record_initiative_design_review", itemId: "BI-1", gate: "design-spec",
    artifactRef: { kind: "document-version", versionId: "version-1" }, reviewerUserId: "reviewer",
    reviewerAgentId: "AGT-REVIEW", authorityDecisionId: "AUTH-1",
    boundReviewTask: { taskRunId: "TR-PRESENT", requestDigest, executionFence: captureTaskExecutionFence({}, requestDigest)! } };
  const locked = { status: "working", progressPayload: {}, a2aMetadata: { reassessmentExecution: {
    schemaVersion: 2, manifestArtifactId: "ta-root", manifestDigest: "1".repeat(64),
  } } };
  expect(await checkBoundReviewWriteExecution(scope, locked)).toMatchObject({ ok: false, code: "AUTHORIZATION_DENIED" });
});

it("keeps canonical receipt identity stable across ephemeral execution generations", () => {
  const scope: BoundReviewScope = { actionKey: "record_initiative_design_review", itemId: "BI-1", gate: "design-spec",
    artifactRef: { kind: "document-version", versionId: "version-1" }, reviewerUserId: "reviewer",
    reviewerAgentId: "AGT-REVIEW", authorityDecisionId: "AUTH-1",
    boundReviewTask: { taskRunId: "TR-ORIGINAL", requestDigest: "9".repeat(64) } };
  const originalId = boundReviewReceiptId(scope, "artifact-digest");
  for (const reservation of [null, "later-admission"]) {
    const next: BoundReviewScope = { ...scope, boundReviewTask: { ...scope.boundReviewTask!, executionFence: {
      schemaVersion: 1, reservation, dispatchClaim: "dispatch-2", authorityDigest: null, requestDigest: "9".repeat(64),
    } } };
    expect(boundReviewReceiptId(next, "artifact-digest")).toBe(originalId);
  }
});

describe("bounded transaction-race reconciliation", () => {
  it.each(["40001", "40P01"])("reads only the winner after the Prisma raw-query conflict %s", async originalCode => {
    const failure = Object.assign(new Error("TransactionWriteConflict"), {
      code: "P2010", meta: { driverAdapterError: { cause: {
        originalCode, kind: "TransactionWriteConflict",
      } } },
    });
    const refusal = { ok: false, code: "AUTHORIZATION_DENIED" };
    const publish = vi.fn(async (winnerOnly: boolean) => {
      if (!winnerOnly) throw failure;
      return refusal;
    });
    expect(await publishBoundReviewEffect(true, publish)).toBe(refusal);
    expect(publish.mock.calls).toEqual([[false], [true]]);
  });

  it("does not reconcile an unbound raw-query conflict", async () => {
    const failure = { code: "P2010", meta: { driverAdapterError: { cause: { originalCode: "40001" } } } };
    const publish = vi.fn(async () => { throw failure; });
    await expect(publishBoundReviewEffect(false, publish)).rejects.toBe(failure);
    expect(publish).toHaveBeenCalledOnce();
  });

  it.each(["23505", "08006", "42883", undefined])("does not reconcile an unrelated raw-query error (%s)", async originalCode => {
    const failure = Object.assign(new Error("Raw query failed"), {
      code: "P2010", meta: { driverAdapterError: { cause: { originalCode } } },
    });
    const publish = vi.fn(async () => { throw failure; });
    await expect(publishBoundReviewEffect(true, publish)).rejects.toBe(failure);
    expect(publish).toHaveBeenCalledOnce();
  });

  it.each(["P2034", "P2002"])("reads a committed winner after %s without retrying the write", async (code) => {
    const winner = { ok: true, receiptId: "canonical-winner", decision: "fail" };
    const publish = vi.fn(async (winnerOnly: boolean) => {
      if (!winnerOnly) throw Object.assign(new Error("Concurrent publication."), { code });
      return winner;
    });
    expect(await publishBoundReviewEffect(true, publish)).toBe(winner);
    expect(publish.mock.calls).toEqual([[false], [true]]);
  });

  it("preserves cancellation observed while reading the race winner", async () => {
    const refusal = { ok: false, code: "AUTHORIZATION_DENIED" };
    const publish = vi.fn(async (winnerOnly: boolean) => {
      if (!winnerOnly) throw Object.assign(new Error("Concurrent publication."), { code: "P2034" });
      return refusal;
    });
    expect(await publishBoundReviewEffect(true, publish)).toBe(refusal);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it.each(["P2034", "unrelated"])("does not retry an unbound call or unrelated failure (%s)", async (code) => {
    const failure = Object.assign(new Error("Refused."), { code });
    const publish = vi.fn(async () => { throw failure; });
    await expect(publishBoundReviewEffect(code === "unrelated", publish)).rejects.toBe(failure);
    expect(publish).toHaveBeenCalledOnce();
  });

  it("does not loop when winner reconciliation itself races", async () => {
    const failure = Object.assign(new Error("Still changing."), { code: "P2034" });
    const publish = vi.fn(async () => { throw failure; });
    await expect(publishBoundReviewEffect(true, publish)).rejects.toBe(failure);
    expect(publish.mock.calls).toEqual([[false], [true]]);
  });
});
