import { beforeEach, describe, expect, it, vi } from "vitest";

// The proposal reads through $queryRaw only: portfolios, budgets and items.
const db = vi.hoisted(() => ({ items: [] as unknown[], budgets: [] as unknown[] }));
vi.mock("@dpf/db", () => ({
  prisma: {
    $queryRaw: async (parts: TemplateStringsArray) => {
      const sql = parts.join("");
      if (sql.includes('"BacklogItem"')) return db.items;
      if (sql.includes('"PortfolioBudgetPeriod"')) return db.budgets;
      return [{ id: "p1", slug: "a", name: "A" }];
    },
  },
}));

import { portfolioBudgetPack } from "./portfolio-budget-pack";

const propose = portfolioBudgetPack.handlers["propose_portfolio_budgets"]!;

const done = (itemId: string, completedAt: string) => ({
  itemId, status: "done", effortSize: "large", jobSize: null, estimateAgreed: null, storedPortfolioId: "p1", storedPortfolioDangling: false,
  productPortfolioId: null, taxonomyPortfolioId: null, coworkerNeedPortfolioId: null, epicPortfolioId: null, activeBuildId: null,
  hasLiveWorkroom: false, deliverySurface: "other", traced: false, completedAt: new Date(completedAt),
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T00:00:00Z"));
  db.items = [done("in", "2026-09-01T00:00:00Z"), done("old", "2026-06-01T00:00:00Z")];
  db.budgets = [];
});

describe("propose_portfolio_budgets", () => {
  it("advertises trailingDays and stays read-only", () => {
    const def = portfolioBudgetPack.definitions.find((d) => d.name === "propose_portfolio_budgets")!;
    expect(def.sideEffect).toBe(false);
    expect((def.inputSchema as { properties: Record<string, unknown> }).properties).toHaveProperty("trailingDays");
  });

  it("proposes from the trailing window and offers a provisional reason to apply it with", async () => {
    const result = await propose({ trailingDays: 90 }, "user-1");
    expect(result.success).toBe(true);
    const data = result.data as { basis: unknown; rows: Array<Record<string, unknown>>; suggestedReason: string };
    expect(data.basis).toEqual({ kind: "trailing-days", days: 90, scale: 92 / 90 });
    expect(data.rows[0]).toMatchObject({ id: "p1", deliveredPoints: 8, proposedPoints: 8, currentBudget: null, currentBudgetLabel: "No budget set" });
    expect(data.suggestedReason).toMatch(/^Provisional, revisable: proposed from points delivered in the 90 days 2026-07-08 to 2026-10-06/);
  });

  it("refuses an invalid window without reading", async () => {
    const result = await propose({ trailingDays: 0 }, "user-1");
    expect(result).toMatchObject({ success: false, error: "invalid_basis" });
  });

  it("keeps the previous-quarter basis by default", async () => {
    const result = await propose({}, "user-1");
    expect((result.data as { basis: { kind: string } }).basis.kind).toBe("previous-quarter");
  });
});
