import { afterEach, describe, expect, it, vi } from "vitest";

// Exercises the CRM tool handler bodies in executeTool: param marshalling,
// validation, message formatting, and delegation to the crm.ts actions.
// prisma (read handlers) and @/lib/actions/crm (write handlers) are mocked.

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    customerAccount: { findMany: vi.fn() },
    opportunity: { findMany: vi.fn(), findFirst: vi.fn() },
    quote: { findMany: vi.fn() },
  },
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
  DISCOVERY_TRIAGE_AGENT_ID: "discovery-triage",
}));

const { mockCrm } = vi.hoisted(() => ({
  mockCrm: {
    createCustomerAccount: vi.fn(),
    createOpportunity: vi.fn(),
    createQuote: vi.fn(),
  },
}));

vi.mock("@/lib/actions/crm", () => mockCrm);

import { executeTool } from "@/lib/mcp-tools";

afterEach(() => vi.clearAllMocks());

describe("CRM tool handlers", () => {
  it("list_customer_accounts summarizes accounts with their counts", async () => {
    mockPrisma.customerAccount.findMany.mockResolvedValue([
      { id: "a1", accountId: "ACCT-1", name: "Acme", status: "prospect", industry: "Tech", _count: { opportunities: 2, quotes: 1 } },
    ]);
    const res = await executeTool("list_customer_accounts", {}, "user_test");
    expect(res.success).toBe(true);
    expect(res.message).toMatch(/Acme \(ACCT-1\) — prospect, Tech/);
  });

  it("list_opportunities formats rows and excludes dormant opportunities by default", async () => {
    mockPrisma.opportunity.findMany.mockResolvedValue([
      { id: "o1", opportunityId: "OPP-1", title: "Acme renewal", stage: "proposal", probability: 60, expectedValue: "12000", currency: "USD", expectedClose: null, account: { name: "Acme" } },
    ]);
    const res = await executeTool("list_opportunities", {}, "user_test");
    expect(res.success).toBe(true);
    expect(res.message).toMatch(/Acme renewal \(OPP-1\) — proposal 60%/);
    expect(mockPrisma.opportunity.findMany.mock.calls[0][0].where.isDormant).toBe(false);
  });

  it("list_opportunities returns an explicit empty-pipeline message", async () => {
    mockPrisma.opportunity.findMany.mockResolvedValue([]);
    const res = await executeTool("list_opportunities", {}, "user_test");
    expect(res.success).toBe(true);
    expect(res.message).toMatch(/No opportunities in the pipeline yet/);
  });

  it("create_opportunity requires title and accountId and does not call the action without them", async () => {
    const res = await executeTool("create_opportunity", { title: "X" }, "user_test");
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/accountId/);
    expect(mockCrm.createOpportunity).not.toHaveBeenCalled();
  });

  it("create_opportunity delegates to the CRM action, threads the userId, and reports the new id", async () => {
    mockCrm.createOpportunity.mockResolvedValue({ id: "o9", opportunityId: "OPP-9", title: "New deal", stage: "qualification", account: { name: "Acme" } });
    const res = await executeTool("create_opportunity", { title: "New deal", accountId: "a1", expectedValue: 5000 }, "user_test");
    expect(res.success).toBe(true);
    expect(res.message).toMatch(/OPP-9/);
    expect(mockCrm.createOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({ title: "New deal", accountId: "a1", expectedValue: 5000, userId: "user_test" }),
    );
  });

  it("create_quote validates that at least one line item is present", async () => {
    const res = await executeTool("create_quote", { opportunityId: "o1", validUntil: "2026-07-31", lineItems: [] }, "user_test");
    expect(res.success).toBe(false);
    expect(mockCrm.createQuote).not.toHaveBeenCalled();
  });

  it("create_quote drafts a quote, passes line items through, and surfaces the computed total", async () => {
    mockCrm.createQuote.mockResolvedValue({ quoteId: "QUO-1", quoteNumber: "QUO-2026-0001", status: "draft", currency: "USD", totalAmount: "1100" });
    const res = await executeTool(
      "create_quote",
      {
        opportunityId: "o1",
        validUntil: "2026-07-31",
        lineItems: [{
          description: "Configured setup",
          quantity: 1,
          unitPrice: 1000,
          taxPercent: 10,
          catalogItemId: "catalog-row",
          catalogSkuId: "sku-row",
          configurationSnapshot: {
            capturedAt: "2026-07-28T12:00:00.000Z",
            selections: { finish: "walnut" },
          },
        }],
      },
      "user_test",
    );
    expect(res.success).toBe(true);
    expect(res.message).toMatch(/QUO-2026-0001/);
    expect(res.message).toMatch(/draft and has not been sent/);
    expect(mockCrm.createQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: "o1",
        validUntil: "2026-07-31",
        userId: "user_test",
        lineItems: [expect.objectContaining({
          description: "Configured setup",
          quantity: 1,
          unitPrice: 1000,
          taxPercent: 10,
          catalogItemId: "catalog-row",
          catalogSkuId: "sku-row",
          configurationSnapshot: {
            capturedAt: "2026-07-28T12:00:00.000Z",
            selections: { finish: "walnut" },
          },
        })],
      }),
    );
  });
});
