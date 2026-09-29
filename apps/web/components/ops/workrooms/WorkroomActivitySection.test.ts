import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { workroomInventoryWhere } from "./WorkroomActivitySection";

// EP-2FB6C0CC, BI-2EA3BB99 — AC-AREA-WORK: an area's Work view runs the same
// inventory query as /ops/workrooms, narrowed to its portfolio and nothing else,
// so both views list the same rooms for that portfolio.
describe("workroomInventoryWhere", () => {
  it("reads every room for the full inventory", () => {
    expect(workroomInventoryWhere()).toEqual({});
  });

  it("narrows only by portfolio for an area's Work view", () => {
    expect(workroomInventoryWhere("productsAndServicesSold")).toEqual({ portfolioRole: "productsAndServicesSold" });
  });
});
