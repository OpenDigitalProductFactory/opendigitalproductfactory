import { describe, expect, it } from "vitest";
import { captureTaskExecutionFence, parseTaskExecutionFence, sameTaskExecutionFence } from "./task-execution-fence";

describe("admitted task execution identity", () => {
  it("distinguishes an admitted initial generation from a missing callback fence", () => {
    const initial = captureTaskExecutionFence(null);
    expect(initial).toEqual({ schemaVersion: 1, reservation: null, dispatchClaim: null, authorityDigest: null, requestDigest: null });
    expect(parseTaskExecutionFence(undefined)).toBeNull();
    expect(sameTaskExecutionFence(initial, captureTaskExecutionFence({}))).toBe(true);
  });

  it.each([
    { resumeReservedAt: "new-reservation" },
    { dispatch: { claimedAt: "new-dispatch" } },
    { reviewExecutionAuthority: { schemaVersion: 1, tokenId: "new-authority" } },
  ])("does not lend a later generation to the old admitted identity: %j", (progress) => {
    expect(sameTaskExecutionFence(captureTaskExecutionFence({}), captureTaskExecutionFence(progress))).toBe(false);
  });

  it("captures authority by content and never exposes its identity in the signed fence", () => {
    const progress = { reviewExecutionAuthority: { schemaVersion: 1, tokenId: "private-token-id", recordedAt: "before" } };
    const first = captureTaskExecutionFence(progress);
    expect(first?.authorityDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toContain("private-token-id");
    progress.reviewExecutionAuthority.recordedAt = "after";
    expect(sameTaskExecutionFence(first, captureTaskExecutionFence(progress))).toBe(false);
  });

  it("binds the originally admitted request rather than a callback's current request", () => {
    expect(sameTaskExecutionFence(captureTaskExecutionFence({}, "9".repeat(64)), captureTaskExecutionFence({}, "8".repeat(64)))).toBe(false);
    expect(captureTaskExecutionFence({}, "invalid")).toBeNull();
  });

  it.each([[], { resumeReservedAt: 42 }, { dispatch: [] }, { dispatch: { claimedAt: 42 } },
    { reviewExecutionAuthority: "unreadable" }])("refuses malformed current generation data: %j", (progress) => {
    expect(captureTaskExecutionFence(progress)).toBeNull();
  });

  it.each([
    { schemaVersion: 2, reservation: null, dispatchClaim: null, authorityDigest: null, requestDigest: null },
    { schemaVersion: 1, reservation: null, dispatchClaim: null, requestDigest: null },
    { schemaVersion: 1, reservation: null, dispatchClaim: null, authorityDigest: "invalid", requestDigest: null },
    { schemaVersion: 1, reservation: null, dispatchClaim: null, authorityDigest: null, requestDigest: "invalid" },
    { schemaVersion: 1, reservation: " padded ", dispatchClaim: null, authorityDigest: null, requestDigest: null },
    { schemaVersion: 1, reservation: null, dispatchClaim: null, authorityDigest: null, requestDigest: null, forged: true },
  ])("refuses incomplete or future callback formats: %j", (fence) => {
    expect(parseTaskExecutionFence(fence)).toBeNull();
  });
});
