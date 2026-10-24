import { describe, expect, it, vi } from "vitest";

// BI-660E165F: a Build Studio room binds the item's delivery shape the way a
// governed claim does, so the readiness policy judges the build by its shape
// (small/medium: no spec, no plan document) instead of the v2 feature profile.
const { mockPersist } = vi.hoisted(() => ({ mockPersist: vi.fn() }));
vi.mock("./claim-backlog-item-handler", () => ({ persistClaimShape: mockPersist }));
vi.mock("@/lib/explore/build-process-matrix", () => ({ deriveDeliverableSensitivity: () => "low" }));

import { bindBuildStudioDeliveryShape } from "./build-studio-attachment";

const db = {} as never;

describe("bindBuildStudioDeliveryShape", () => {
  it("binds delivery-medium for a medium feature item", async () => {
    mockPersist.mockResolvedValue(undefined);
    const out = await bindBuildStudioDeliveryShape({
      db,
      capsuleId: "WC-1",
      backlogItem: { id: "c1", itemId: "BI-1", title: "T", body: "B", epicId: null, effortSize: "medium", workType: "feature" },
    });
    expect(out.bound).toBe("delivery-medium@1.0.0");
    expect(mockPersist).toHaveBeenCalledWith(db, "WC-1", expect.objectContaining({ kind: "derived", key: "delivery-medium" }));
  });

  it("leaves the room unshaped when the signals do not agree, and never guesses", async () => {
    mockPersist.mockClear();
    const out = await bindBuildStudioDeliveryShape({
      db,
      capsuleId: "WC-2",
      backlogItem: { id: "c2", itemId: "BI-2", title: "T", body: "B", epicId: null, effortSize: null, workType: "feature" },
    });
    expect(out.bound).toBeNull();
    expect(mockPersist).not.toHaveBeenCalled();
  });
});
