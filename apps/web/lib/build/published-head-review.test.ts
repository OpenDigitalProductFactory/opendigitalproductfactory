import { describe, expect, it, vi } from "vitest";
import {
  PUBLISHED_HEAD_REVIEW_MAX_ATTEMPTS,
  PUBLISHED_HEAD_REVIEW_RETRY_MS,
  publishedHeadAttemptMarker,
  reviewPublishedHeadForShipBuild,
  type PublishedHeadReviewDeps,
} from "./published-head-review";

// FB-2F2D46D5 / PR #6983 / WC-8B8A9D6F on 2026-11-13: the build was reviewed at
// sandbox commits that never reached GitHub, then published as d38a3c56.
const PUBLISHED = "d38a3c56ecbff59bcaae05edc7cde7ec7b67e54e";
const SANDBOX_REVIEWED = ["174a07ebfaa7a0ad0b5c18eb3a9628b4a6e5048b", "1bd64a365f95d476eeccab31a8dc425675d4a44b"];
const NOW = new Date("2026-11-13T20:00:00Z");

function deps(overrides: Partial<PublishedHeadReviewDeps> = {}): PublishedHeadReviewDeps {
  return {
    load: vi.fn(async () => ({ phase: "ship", buildExecState: { sourceCurrency: { status: "ahead" }, kept: 1 }, publishedHeadSha: PUBLISHED })),
    hasReceiptAt: vi.fn(async (sha: string) => SANDBOX_REVIEWED.includes(sha)),
    attempts: vi.fn(async () => []),
    align: vi.fn(async () => ({ status: "aligned" as const, headSha: PUBLISHED })),
    returnToReview: vi.fn(async () => true),
    queueReview: vi.fn(async () => {}),
    record: vi.fn(async () => {}),
    now: () => NOW,
    ...overrides,
  };
}

describe("reviewPublishedHeadForShipBuild (BI-C49EC080)", () => {
  it("sends a build whose PR head was never reviewed back to review on that exact commit", async () => {
    const d = deps();
    await expect(reviewPublishedHeadForShipBuild("FB-2F2D46D5", d)).resolves.toBe("returned-to-review");
    expect(d.hasReceiptAt).toHaveBeenCalledWith(PUBLISHED, "FB-2F2D46D5");
    expect(d.align).toHaveBeenCalledWith("FB-2F2D46D5", PUBLISHED);
    // The aligned tree is a new tree: the old tree's snapshot is dropped, the rest kept.
    expect(d.returnToReview).toHaveBeenCalledWith("FB-2F2D46D5", { kept: 1 });
    expect(d.queueReview).toHaveBeenCalledWith("FB-2F2D46D5");
    const summary = vi.mocked(d.record).mock.calls[0]?.[1] ?? "";
    expect(summary.startsWith(publishedHeadAttemptMarker(PUBLISHED))).toBe(true);
    expect(summary).toContain("Returned to review");
  });

  it("leaves a build alone once a review exists for its published head", async () => {
    const d = deps({ hasReceiptAt: vi.fn(async () => true) });
    await expect(reviewPublishedHeadForShipBuild("FB-1", d)).resolves.toBe("reviewed");
    expect(d.align).not.toHaveBeenCalled();
    expect(d.record).not.toHaveBeenCalled();
  });

  it("does nothing outside ship or before a PR is published", async () => {
    const inReview = deps({ load: vi.fn(async () => ({ phase: "review", buildExecState: {}, publishedHeadSha: PUBLISHED })) });
    await expect(reviewPublishedHeadForShipBuild("FB-1", inReview)).resolves.toBe("not-applicable");
    const noPr = deps({ load: vi.fn(async () => ({ phase: "ship", buildExecState: {}, publishedHeadSha: null })) });
    await expect(reviewPublishedHeadForShipBuild("FB-1", noPr)).resolves.toBe("not-applicable");
    expect(inReview.align).not.toHaveBeenCalled();
    expect(noPr.align).not.toHaveBeenCalled();
  });

  it("spaces attempts for the same head and stops after the bound", async () => {
    const recent = deps({ attempts: vi.fn(async () => [{ headSha: PUBLISHED, at: new Date(NOW.getTime() - PUBLISHED_HEAD_REVIEW_RETRY_MS + 60_000) }]) });
    await expect(reviewPublishedHeadForShipBuild("FB-1", recent)).resolves.toBe("recently-attempted");
    expect(recent.align).not.toHaveBeenCalled();

    const old = new Date(NOW.getTime() - PUBLISHED_HEAD_REVIEW_RETRY_MS - 1);
    const exhausted = deps({ attempts: vi.fn(async () => Array.from({ length: PUBLISHED_HEAD_REVIEW_MAX_ATTEMPTS }, () => ({ headSha: PUBLISHED, at: old }))) });
    await expect(reviewPublishedHeadForShipBuild("FB-1", exhausted)).resolves.toBe("exhausted");
    expect(exhausted.align).not.toHaveBeenCalled();
  });

  it("treats a new published head (a follow-up commit) as new work", async () => {
    const d = deps({ attempts: vi.fn(async () => [{ headSha: SANDBOX_REVIEWED[0]!, at: NOW }]) });
    await expect(reviewPublishedHeadForShipBuild("FB-1", d)).resolves.toBe("returned-to-review");
  });

  it("records a refused alignment and keeps the build in ship", async () => {
    const d = deps({ align: vi.fn(async () => ({ status: "refused" as const, reason: "the published commit's parent is not on client/x" })) });
    await expect(reviewPublishedHeadForShipBuild("FB-1", d)).resolves.toBe("not-aligned");
    expect(d.returnToReview).not.toHaveBeenCalled();
    expect(d.queueReview).not.toHaveBeenCalled();
    const summary = vi.mocked(d.record).mock.calls[0]?.[1] ?? "";
    expect(summary.startsWith(publishedHeadAttemptMarker(PUBLISHED))).toBe(true);
    expect(summary).toContain("parent is not on client/x");
  });

  it("records an alignment that throws instead of failing the reconciler tick", async () => {
    const d = deps({ align: vi.fn(async () => { throw new Error("fetch failed: 403"); }) });
    await expect(reviewPublishedHeadForShipBuild("FB-1", d)).resolves.toBe("not-aligned");
    expect(vi.mocked(d.record).mock.calls[0]?.[1]).toContain("fetch failed: 403");
  });

  it("refuses an alignment that lands anywhere but the published head", async () => {
    const d = deps({ align: vi.fn(async () => ({ status: "aligned" as const, headSha: "f".repeat(40) })) });
    await expect(reviewPublishedHeadForShipBuild("FB-1", d)).resolves.toBe("not-aligned");
    expect(d.returnToReview).not.toHaveBeenCalled();
  });
});
