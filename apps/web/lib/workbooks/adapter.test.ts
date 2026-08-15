import { describe, expect, it, vi } from "vitest";

import { queryBoundedRowsOnce, type DataSourceAdapter } from "./adapter";

describe("queryBoundedRowsOnce (BI-9DB20C39)", () => {
  it("asks the adapter for the bounded eager dataset exactly once", async () => {
    const queryRows = vi.fn(async () => ({
      data: [{ rowId: "1", cells: { status: "open" } }],
      nextCursor: null,
    }));
    const adapter = { queryRows } as unknown as DataSourceAdapter;
    const filters = {
      conditions: [{ field: "status", operator: "in" as const, value: ["open"] }],
      logic: "and" as const,
    };

    await expect(
      queryBoundedRowsOnce(adapter, "backlog_item", {
        filters,
        sort: [],
        limit: 20_000,
      }),
    ).resolves.toEqual({
      data: [{ rowId: "1", cells: { status: "open" } }],
      nextCursor: null,
    });
    expect(queryRows).toHaveBeenCalledTimes(1);
    expect(queryRows).toHaveBeenCalledWith("backlog_item", {
      filters,
      sort: [],
      pagination: { cursor: null, limit: 20_000 },
    });
  });
});
