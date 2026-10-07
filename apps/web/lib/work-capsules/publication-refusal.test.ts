import { beforeEach, describe, expect, it, vi } from "vitest";

const readiness = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("@/lib/change-review/failure-readiness-publication", () => ({
  checkWorkroomFailureReadiness: readiness.check,
}));

import { assertWorkroomPublishable } from "./publication-refusal";
import { WorkCapsulePublicationRefusedError } from "./work-capsule-terminal-status";

const refused = { mayPublish: false, code: "failure_review_required", reason: "No failure-analysis review exists for this final change." };
const room = {
  capsuleId: "WC-BFDF763B",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  pullRequestNumber: 5896,
  backlogItemId: "BI-3BF3CBDF",
};

async function refusalFor(input: Parameters<typeof assertWorkroomPublishable>[0]) {
  try {
    await assertWorkroomPublishable(input);
  } catch (error) {
    return error as WorkCapsulePublicationRefusedError;
  }
  throw new Error("expected a refusal");
}

// BI-C9912C22 AC-2: the review boundary still refuses `complete`; it is not
// relaxed. What changes is that a delivered room's refusal carries the
// close-out that does not require re-gating merged code.
describe("assertWorkroomPublishable delivered close-out (BI-C9912C22)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readiness.check.mockResolvedValue(refused);
  });

  it("still refuses complete, and names the archived close-out when the PR is bound and the item is done", async () => {
    const backlogItem = { findFirst: vi.fn().mockResolvedValue({ itemId: "BI-3BF3CBDF", status: "done" }) };
    const error = await refusalFor({ ...room, status: "complete", backlogItem });
    expect(error).toBeInstanceOf(WorkCapsulePublicationRefusedError);
    expect(error.code).toBe("failure_review_required");
    expect(error.deliveredCloseout).toEqual({ backlogItemId: "BI-3BF3CBDF", pullRequestNumber: 5896, status: "archived" });
    expect(backlogItem.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ itemId: "BI-3BF3CBDF" }, { id: "BI-3BF3CBDF" }] },
      select: { itemId: true, status: true },
    });
  });

  it("names no close-out while the item is not done", async () => {
    const backlogItem = { findFirst: vi.fn().mockResolvedValue({ itemId: "BI-3BF3CBDF", status: "in_progress" }) };
    expect((await refusalFor({ ...room, status: "complete", backlogItem })).deliveredCloseout).toBeUndefined();
  });

  it("names no close-out for a room with no pull request", async () => {
    const backlogItem = { findFirst: vi.fn().mockResolvedValue({ itemId: "BI-3BF3CBDF", status: "done" }) };
    expect((await refusalFor({ ...room, pullRequestNumber: null, status: "complete", backlogItem })).deliveredCloseout).toBeUndefined();
    expect(backlogItem.findFirst).not.toHaveBeenCalled();
  });

  it("names no close-out for a pre-publication status", async () => {
    const backlogItem = { findFirst: vi.fn().mockResolvedValue({ itemId: "BI-3BF3CBDF", status: "done" }) };
    expect((await refusalFor({ ...room, status: "ready-for-review", backlogItem })).deliveredCloseout).toBeUndefined();
  });

  it("never names a close-out for an identity refusal", async () => {
    readiness.check.mockResolvedValue({ mayPublish: false, code: "workroom_identity_incomplete", reason: "headSha not set" });
    const backlogItem = { findFirst: vi.fn().mockResolvedValue({ itemId: "BI-3BF3CBDF", status: "done" }) };
    expect((await refusalFor({ ...room, status: "complete", backlogItem })).deliveredCloseout).toBeUndefined();
  });
});
