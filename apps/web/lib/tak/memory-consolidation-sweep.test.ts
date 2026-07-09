import { describe, it, expect } from "vitest";
import { planBatchDedupe, type SweepEntry } from "./memory-consolidation-sweep";

const at = (iso: string) => new Date(iso);

describe("planBatchDedupe", () => {
  it("returns no plan when all entries are distinct concepts", () => {
    const entries: SweepEntry[] = [
      { id: "a", key: "cloud_provider", value: "AWS", createdAt: at("2026-07-01") },
      { id: "b", key: "editor", value: "neovim", createdAt: at("2026-07-02") },
      { id: "c", key: "testing_approach", value: "TDD", createdAt: at("2026-07-03") },
    ];
    expect(planBatchDedupe(entries)).toEqual([]);
  });

  it("supersedes an older near-duplicate in favor of the newest as canonical", () => {
    const entries: SweepEntry[] = [
      { id: "old", key: "preferred_cloud_provider", value: "AWS", createdAt: at("2026-07-01") },
      { id: "new", key: "cloud_provider_preferred", value: "GCP", createdAt: at("2026-07-05") },
    ];
    const plan = planBatchDedupe(entries);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ loserId: "old", winnerId: "new" });
  });

  it("collapses a cluster of three near-duplicates to one canonical winner", () => {
    const entries: SweepEntry[] = [
      { id: "v1", key: "review_style", value: "terse", createdAt: at("2026-07-01") },
      { id: "v2", key: "review_style_preferred", value: "bullets", createdAt: at("2026-07-02") },
      { id: "v3", key: "preferred_review_style", value: "prose", createdAt: at("2026-07-03") },
    ];
    const plan = planBatchDedupe(entries);
    // v3 is newest → winner; v1 and v2 superseded by it.
    expect(plan).toHaveLength(2);
    expect(plan.every((p) => p.winnerId === "v3")).toBe(true);
    expect(plan.map((p) => p.loserId).sort()).toEqual(["v1", "v2"]);
  });

  it("keeps two clusters separate", () => {
    const entries: SweepEntry[] = [
      { id: "cloud-old", key: "cloud_provider", value: "AWS", createdAt: at("2026-07-01") },
      { id: "cloud-new", key: "preferred_cloud_provider", value: "GCP", createdAt: at("2026-07-04") },
      { id: "editor", key: "editor_choice", value: "vim", createdAt: at("2026-07-02") },
    ];
    const plan = planBatchDedupe(entries);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ loserId: "cloud-old", winnerId: "cloud-new" });
  });

  it("is stable regardless of input order", () => {
    const base: SweepEntry[] = [
      { id: "old", key: "preferred_cloud_provider", value: "AWS", createdAt: at("2026-07-01") },
      { id: "new", key: "cloud_provider_preferred", value: "GCP", createdAt: at("2026-07-05") },
    ];
    const forward = planBatchDedupe(base);
    const reversed = planBatchDedupe([...base].reverse());
    expect(reversed).toEqual(forward);
  });

  it("returns no plan for an empty scope", () => {
    expect(planBatchDedupe([])).toEqual([]);
  });
});
