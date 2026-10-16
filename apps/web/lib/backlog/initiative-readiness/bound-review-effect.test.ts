import { describe, expect, it, vi } from "vitest";
import { boundReviewReceiptId, publishBoundReviewEffect, type BoundReviewScope } from "./bound-review-effect";

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
