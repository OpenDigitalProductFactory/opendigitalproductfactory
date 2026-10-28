import { describe, expect, it } from "vitest";

import { loadCompleteSeries, type SeriesPage } from "./guard-outcome-store";

function pager(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({
    id: `r${String(i).padStart(4, "0")}`,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, i)),
    details: { n: i },
  }));
  const calls: Array<SeriesPage["cursor"]> = [];
  const fetchPage = async ({ cursor, take }: SeriesPage) => {
    calls.push(cursor);
    const start = cursor ? rows.findIndex((r) => r.id === cursor.id) + 1 : 0;
    return rows.slice(start, start + take);
  };
  return { fetchPage, calls };
}

describe("loadCompleteSeries", () => {
  it("pages by a stable cursor until the series is exhausted", async () => {
    const { fetchPage, calls } = pager(25);
    const result = await loadCompleteSeries(fetchPage, { pageSize: 10, maxRows: 100 });
    expect(result).toMatchObject({ complete: true });
    expect(result.rows).toHaveLength(25);
    expect(calls).toHaveLength(3);
    expect(calls[1]).toEqual({ id: "r0009", createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, 9)) });
  });

  it("reports an over-cap series as incomplete instead of settling it on a truncated page", async () => {
    const { fetchPage } = pager(31);
    const result = await loadCompleteSeries(fetchPage, { pageSize: 10, maxRows: 30 });
    expect(result).toEqual({ complete: false, rows: [] });
  });

  it("an empty series is complete", async () => {
    const { fetchPage } = pager(0);
    expect(await loadCompleteSeries(fetchPage, { pageSize: 10, maxRows: 30 })).toEqual({ complete: true, rows: [] });
  });
});
