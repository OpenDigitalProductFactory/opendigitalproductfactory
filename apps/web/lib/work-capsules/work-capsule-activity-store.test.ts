import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));
vi.mock("@/lib/work-capsules/activity-events", () => ({ publishRecordedWorkCapsuleActivity: vi.fn() }));
import { publishRecordedWorkCapsuleActivity } from "./activity-events";
import { recordWorkCapsuleActivity } from "./work-capsule-activity-store";

describe("transactional Workroom activity", () => {
  it("persists without announcing a transaction that has not committed", async () => {
    const create = vi.fn().mockResolvedValue({ id: "activity-1" });
    const activity = await recordWorkCapsuleActivity({ workroomActivity: { create } } as never, {
      workCapsuleId: "room-1", kind: "evidence-recorded", summary: "Receipt recorded",
      actor: { userId: "user-1", agentId: null, principalId: null },
    }, { deferPublication: true });
    expect(activity.id).toBe("activity-1");
    expect(publishRecordedWorkCapsuleActivity).not.toHaveBeenCalled();
  });
});
