import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, notFound } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    quote: {
      findUnique,
    },
  },
}));

vi.mock("next/navigation", () => ({
  notFound,
}));

import QuoteDetailPage from "./page";

describe("QuoteDetailPage", () => {
  beforeEach(() => {
    findUnique.mockResolvedValue({
      id: "quote-1",
      quoteNumber: "QUO-2026-0007",
      version: 2,
      status: "sent",
      validFrom: new Date("2026-06-01T10:00:00.000Z"),
      validUntil: new Date("2026-06-30T10:00:00.000Z"),
      subtotal: 1200,
      discountType: "percentage",
      discountValue: 10,
      taxAmount: 216,
      totalAmount: 1296,
      currency: "USD",
      terms: "Net 14",
      notes: "Includes implementation support.",
      sentAt: new Date("2026-06-02T10:00:00.000Z"),
      acceptedAt: null,
      rejectedAt: null,
      createdAt: new Date("2026-06-01T10:00:00.000Z"),
      updatedAt: new Date("2026-06-02T10:00:00.000Z"),
      createdBy: { email: "seller@example.test" },
      account: {
        id: "acct-1",
        accountId: "ACCT-001",
        name: "Founder Ops Ltd",
      },
      opportunity: {
        id: "opp-1",
        opportunityId: "OPP-001",
        title: "Revenue workflow refactor",
        stage: "proposal",
      },
      lineItems: [
        {
          id: "line-1",
          description: "Discovery workshop",
          quantity: 2,
          unitPrice: 300,
          discountPercent: 0,
          taxPercent: 20,
          lineTotal: 600,
          sortOrder: 1,
          product: null,
        },
        {
          id: "line-2",
          description: "Implementation sprint",
          quantity: 1,
          unitPrice: 600,
          discountPercent: 0,
          taxPercent: 20,
          lineTotal: 600,
          sortOrder: 2,
          product: { name: "Delivery Accelerator" },
        },
      ],
      salesOrder: {
        id: "so-1",
        orderRef: "SO-2026-0004",
        status: "confirmed",
        totalAmount: 1296,
        currency: "USD",
      },
    });
  });

  it("renders the quote detail reached from quote links", async () => {
    const html = renderToStaticMarkup(
      await QuoteDetailPage({ params: Promise.resolve({ id: "quote-1" }) }),
    );

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "quote-1" },
      }),
    );
    expect(html).toContain("QUO-2026-0007");
    expect(html).toContain("Founder Ops Ltd");
    expect(html).toContain("Revenue workflow refactor");
    expect(html).toContain("Discovery workshop");
    expect(html).toContain("Implementation sprint");
    expect(html).toContain("Delivery Accelerator");
    expect(html).toContain("USD 1,296");
    expect(html).toContain("SO-2026-0004");
    expect(html).toContain('href="/customer/quotes"');
    expect(html).toContain('href="/customer/opportunities?opportunity=opp-1"');
    expect(html).toContain("var(--dpf-");
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("returns not found for a missing quote", async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      QuoteDetailPage({ params: Promise.resolve({ id: "missing" }) }),
    ).rejects.toThrow("not-found");
    expect(notFound).toHaveBeenCalled();
  });
});
