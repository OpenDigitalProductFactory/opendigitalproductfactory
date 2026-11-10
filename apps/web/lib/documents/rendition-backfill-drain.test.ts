import { describe, expect, it, vi } from "vitest";
import { MAX_BACKFILL_PASSES, drainRenditionBackfill } from "./rendition-backfill-drain";

// BI-153EC72C: one backfill request drains the whole queue in bounded passes.
describe("drainRenditionBackfill", () => {
  it("runs passes from cursor to cursor until a pass hands back none", async () => {
    const pages = [
      { processed: 100, nextCursor: "c1" },
      { processed: 100, nextCursor: "c2" },
      { processed: 7, nextCursor: null },
    ];
    const runPass = vi.fn(async () => pages.shift()!);
    expect(await drainRenditionBackfill({ runPass })).toEqual({ passes: 3, processed: 207, drained: true });
    expect(runPass.mock.calls).toEqual([[1, null], [2, "c1"], [3, "c2"]]);
  });

  it("stops at the pass bound, reporting it did not drain", async () => {
    const runPass = vi.fn(async (pass: number) => ({ processed: 1, nextCursor: `c${pass}` }));
    expect(await drainRenditionBackfill({ runPass, maxPasses: 3 })).toEqual({ passes: 3, processed: 3, drained: false });
    expect(MAX_BACKFILL_PASSES).toBeGreaterThan(1);
  });
});
