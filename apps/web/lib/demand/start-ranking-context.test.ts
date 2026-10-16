import { describe, expect, it, vi } from "vitest";
const preferences = vi.hoisted(() => vi.fn());
vi.mock("../portfolio/investment-balance-server", () => ({ loadInvestmentStartPreferences: preferences }));
import { loadStartRankingContext } from "./start-ranking-context";

describe("start allocation context", () => {
  it("loads owner allocation even when unrelated bucket targets are absent", async () => {
    const db = { backlogItem: { findMany: vi.fn() } };
    const investmentByItem = { "BI-1": { scopeKey: "owner-1", preferred: "refactor" } };
    preferences.mockResolvedValue(investmentByItem);
    expect(await loadStartRankingContext(db, null, ["BI-1"])).toEqual({ investmentByItem });
    expect(preferences).toHaveBeenCalledWith(db, ["BI-1"]);
    expect(db.backlogItem.findMany).not.toHaveBeenCalled();
  });
});
