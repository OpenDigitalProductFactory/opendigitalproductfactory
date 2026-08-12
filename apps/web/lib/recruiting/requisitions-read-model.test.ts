import { describe, expect, it, vi } from "vitest";

import {
  listRecruitingRequisitions,
  type RequisitionsReadClient,
} from "./requisitions-read-model";

function fakeDb(
  rows: Array<{ id: string; reqId: string; title: string; status: string }>,
): RequisitionsReadClient {
  return {
    jobRequisition: { findMany: vi.fn().mockResolvedValue(rows) },
  };
}

describe("listRecruitingRequisitions", () => {
  it("returns an empty list when there are no requisitions", async () => {
    const db = fakeDb([]);
    await expect(listRecruitingRequisitions(db)).resolves.toEqual([]);
  });

  it("orders open/live requisitions ahead of closed ones, then by title", async () => {
    const db = fakeDb([
      { id: "r-closed", reqId: "REQ-1", title: "Alpha", status: "closed" },
      { id: "r-open-b", reqId: "REQ-2", title: "Welder", status: "open" },
      { id: "r-open-a", reqId: "REQ-3", title: "Assembler", status: "open" },
      { id: "r-filled", reqId: "REQ-4", title: "Machinist", status: "filled" },
    ]);

    const result = await listRecruitingRequisitions(db);

    expect(result.map((r) => r.id)).toEqual([
      "r-open-a", // open, "Assembler"
      "r-open-b", // open, "Welder"
      "r-filled", // filled before closed
      "r-closed",
    ]);
  });

  it("selects only the four projected fields", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await listRecruitingRequisitions({ jobRequisition: { findMany } });
    expect(findMany).toHaveBeenCalledWith({
      select: { id: true, reqId: true, title: true, status: true },
    });
  });
});
