import { describe, expect, it, vi } from "vitest";

import { resolveDuplicateBacklogRowId } from "./duplicate-resolution";

describe("resolveDuplicateBacklogRowId", () => {
  it("maps a semantic BI id to the internal FK id", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: "canonical-row-1" });

    await expect(resolveDuplicateBacklogRowId({ backlogItem: { findUnique } }, "BI-CANON")).resolves.toBe(
      "canonical-row-1",
    );
    expect(findUnique).toHaveBeenCalledWith({ where: { itemId: "BI-CANON" }, select: { id: true } });
  });

  it("returns null when the semantic target does not exist", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    await expect(resolveDuplicateBacklogRowId({ backlogItem: { findUnique } }, "BI-MISSING")).resolves.toBeNull();
  });
});
