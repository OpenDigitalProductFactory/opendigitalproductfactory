import { describe, expect, it, vi } from "vitest";
import { deriveReviewerProfile, loadReviewerProfile } from "./reviewer-profile";

describe("authoritative reviewer profile", () => {
  const item = { workType: "bug", featureBuilds: [], activeBuild: null };
  it("retains stronger historical classification despite a repair title or work type", () => {
    expect(deriveReviewerProfile(item, [{ payload: { selectedProfile: "feature" } }])).toBe("feature");
    expect(deriveReviewerProfile(item, [{ payload: { profile: "archetype" } }])).toBe("archetype");
  });
  it("includes historical builds and active builds without weakening current scope", () => {
    expect(deriveReviewerProfile({ ...item, featureBuilds: [{ kind: "feature" }] }, [])).toBe("feature");
    expect(deriveReviewerProfile({ ...item, activeBuild: { kind: "feature" } }, [])).toBe("feature");
  });
  it("does not invent a profile for invalid structured facts", () => {
    expect(deriveReviewerProfile({ ...item, workType: "unknown" }, [])).toBeNull();
  });
  it("loads only classification history and includes historical build signals", async () => {
    const findUnique = vi.fn().mockResolvedValue({ ...item, activities: [{ payload: { profile: "feature" } }] });
    expect(await loadReviewerProfile({ backlogItem: { findUnique } } as never, "BI-TEST")).toBe("feature");
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { itemId: "BI-TEST" },
      select: expect.objectContaining({ featureBuilds: { select: { kind: true } }, activities: expect.objectContaining({
        where: { OR: [{ kind: "initiative_scope_baseline" }, { kind: "initiative_gate_receipt", gateKey: "classification" }] },
      }) }),
    }));
    findUnique.mockResolvedValue(null);
    expect(await loadReviewerProfile({ backlogItem: { findUnique } } as never, "BI-MISSING")).toBeNull();
  });
});
