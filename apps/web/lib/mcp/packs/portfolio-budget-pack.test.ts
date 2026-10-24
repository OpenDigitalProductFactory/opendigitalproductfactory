import { beforeEach, describe, expect, it, vi } from "vitest";
const investment = vi.hoisted(() => ({ save: vi.fn(), bind: vi.fn(), read: vi.fn() }));
const investmentActor = vi.hoisted(() => vi.fn(async () => "p1"));
vi.mock("@/lib/identity/principal-linking", () => ({ resolvePrincipalRecordIdForSessionIdentity: investmentActor }));
vi.mock("@/lib/portfolio/investment-balance-server", () => ({
  saveScopedBalancePolicy: investment.save, bindInvestmentFunding: investment.bind, loadScopedBalanceReport: investment.read,
}));

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
  hasActiveWorkroom: false, deliveredAt: null, deliverySurface: "other", traced: false, completedAt: new Date(completedAt),
});

beforeEach(() => {
  vi.clearAllMocks();
  investmentActor.mockResolvedValue("p1");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T00:00:00Z"));
  db.items = [done("in", "2026-09-01T00:00:00Z"), done("old", "2026-06-01T00:00:00Z")];
  db.budgets = [];
});

describe("propose_portfolio_budgets", () => {
  it("does not expose another funding owner's report to a portfolio manager", async () => {
    investmentActor.mockResolvedValue("manager-b");
    expect(await portfolioBudgetPack.handlers.get_investment_balance!({ scope: { principalId: "p1", organizationId: "org1", purpose: "shared-platform" } }, "manager-user")).toMatchObject({ success: false, error: "not-owner" });
    expect(investment.read).not.toHaveBeenCalled();
  });
  it("passes the same scope report through the external read tool", async () => {
    const scope = { principalId: "p1", organizationId: "org1", purpose: "shared-platform" };
    const data = { scope, policy: { refactorPercent: 80 }, externalInferenceCoverage: "unobserved" };
    investment.read.mockResolvedValue({ ok: true, data });
    expect(await portfolioBudgetPack.handlers.get_investment_balance!({ scope }, "owner-user")).toMatchObject({ success: true, data });
    expect(investment.read).toHaveBeenCalledWith(expect.anything(), scope);
  });
  it("takes the agent identity only from trusted execution context and preserves classification", async () => {
    const scope = { principalId: "p1", organizationId: "org1", purpose: "shared-platform" };
    investment.bind.mockResolvedValue({ ok: true, data: { scope } });
    await portfolioBudgetPack.handlers.bind_investment_funding!({ scope, target: { kind: "workroom", id: "WC-1", itemId: "BI-1" }, expectedBoundAt: null, reason: "Repair documentation", classification: "refactor", agentId: "untrusted-agent" }, "owner-user", { agentId: "trusted-agent" });
    expect(investment.bind).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: "owner-user", agentId: "trusted-agent", classification: "refactor" }));
  });
  it("exposes owner-scoped investment controls through the existing governed pack", () => {
    for (const name of ["get_investment_balance", "set_investment_balance", "bind_investment_funding"]) {
      expect(portfolioBudgetPack.definitions.find((d) => d.name === name)).toBeDefined();
      expect(portfolioBudgetPack.handlers[name]).toBeTypeOf("function");
    }
    expect(portfolioBudgetPack.definitions.find((d) => d.name === "bind_investment_funding")?.consequence).toBe("authority");
  });
  it("rejects incomplete policy input before calling the domain writer", async () => {
    const result = await portfolioBudgetPack.handlers["set_investment_balance"]!({
      scope: { principalId: "p1", organizationId: "org1", purpose: "shared-platform" },
      policy: { refactorPercent: 80 }, expectedRevision: null, reason: "Founder direction",
    }, "user-1");
    expect(result).toMatchObject({ success: false, error: "invalid-investment-input" });
    expect(investment.save).not.toHaveBeenCalled();
  });
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

  it("shows how much of each portfolio's delivery the platform-default rule attributed (BI-291F7451)", async () => {
    db.items = [{ ...done("plat", "2026-09-01T00:00:00Z"), storedPortfolioId: null, scopeKind: "platform", platformDefaultPortfolioId: "p1" }];
    const result = await propose({ trailingDays: 90 }, "user-1");
    const data = result.data as { rows: Array<Record<string, unknown>>; attributedByRuleDeliveredPoints: number; unallocatedDeliveredPoints: number };
    expect(data.rows[0]).toMatchObject({ deliveredPoints: 8, attributedByRule: { basis: "platform-default", deliveredPoints: 8, proposedPoints: 8 } });
    expect(data).toMatchObject({ attributedByRuleDeliveredPoints: 8, unallocatedDeliveredPoints: 0 });
  });
});
