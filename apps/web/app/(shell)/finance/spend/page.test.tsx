import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const fixture = vi.hoisted(() => ({ ownSubmitted: 0 }));
vi.mock("@/lib/actions/shared/guards", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/i18n/t.server", async () => {
  const { translate } = await import("@dpf/i18n");
  return { getT: async () => (key: never) => translate("en-US", "shell", key) };
});
vi.mock("@dpf/db", () => ({ prisma: {
  bill: { aggregate: vi.fn().mockResolvedValue({ _count: 0, _sum: { amountDue: 0 } }) },
  expenseClaim: { count: vi.fn(async ({ where }) => where.employee?.userId === "owner" ? fixture.ownSubmitted : 9) },
  supplier: { count: vi.fn().mockResolvedValue(0) },
  purchaseOrder: { count: vi.fn().mockResolvedValue(0) },
  payment: { count: vi.fn().mockResolvedValue(0) },
} }));
vi.mock("@/lib/actions/currency", () => ({ getOrgSettings: vi.fn().mockResolvedValue({ baseCurrency: "USD" }) }));
vi.mock("@/lib/finance/ai-provider-finance", () => ({ getAiSpendOverview: vi.fn().mockResolvedValue({}),
  maybeRunAiProviderFinanceDailyEvaluation: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/components/finance/FinanceTabNav", () => ({ FinanceTabNav: () => null }));
vi.mock("@/components/finance/AiSpendSummaryCard", () => ({ AiSpendSummaryCard: () => null }));

import { prisma } from "@dpf/db";
import { requireUser } from "@/lib/actions/shared/guards";
import FinanceSpendPage from "./page";

describe("Spend personal-expense metric scope", () => {
  beforeEach(() => {
    vi.clearAllMocks(); fixture.ownSubmitted = 0;
    vi.mocked(requireUser).mockResolvedValue({ id: "owner", platformRole: "HR-000", isSuperuser: true } as never);
  });
  it.each([0, 2])("shows %i own submitted claims even when colleagues have claims", async (count) => {
    fixture.ownSubmitted = count;
    const html = renderToStaticMarkup(await FinanceSpendPage());
    const card = html.match(/<a[^>]*href="\/finance\/my-expenses"[\s\S]*?<\/a>/)?.[0];
    expect(card).toBeDefined();
    expect(card).toContain("My submitted claims");
    expect(card).toContain(`>${count}</p>`);
    expect(prisma.expenseClaim.count).toHaveBeenCalledWith({ where: { status: "submitted", employee: { userId: "owner" } } });
  });
  it("does not read expense counts without an authenticated user", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("Unauthorized"));
    await expect(FinanceSpendPage()).rejects.toThrow("Unauthorized");
    expect(prisma.expenseClaim.count).not.toHaveBeenCalled();
  });
});
