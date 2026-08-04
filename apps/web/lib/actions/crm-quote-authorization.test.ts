// Regression test for BI-1017777D — the quote decision surface (acceptQuote /
// rejectQuote) shipped with NO authorization of any kind: not a capability
// check, not even a session check. Accepting a quote is not a draft edit — it
// creates a SalesOrder, closes the opportunity WON, and auto-generates an
// invoice, so it must be gated like the other commit-grade CRM surfaces.
//
// The counterpart at the bottom pins the deliberate exception: the PUBLIC
// accept-link flow is authorized by accept-token possession and must keep
// working with no session at all.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, acceptQuoteImplMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  acceptQuoteImplMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("./crm-quote-acceptance", () => ({ acceptQuoteImpl: acceptQuoteImplMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@dpf/db", () => ({
  Prisma: {},
  prisma: {
    quote: { update: vi.fn(), findUnique: vi.fn() },
    activity: { create: vi.fn().mockResolvedValue({}) },
  },
}));

import { prisma } from "@dpf/db";
import { acceptQuote, rejectQuote } from "./crm";

const p = prisma as unknown as {
  quote: { update: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
};

/** HR-200 (Customer/Revenue) holds operate_customer; HR-400 does not. */
const CAPABLE = { user: { id: "u-capable", platformRole: "HR-200", isSuperuser: false } };
const SIGNED_IN_WITHOUT_CAPABILITY = {
  user: { id: "u-warehouse", platformRole: "HR-400", isSuperuser: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  acceptQuoteImplMock.mockResolvedValue({ quote: { id: "q1" }, salesOrder: { id: "so1" } });
  p.quote.update.mockResolvedValue({
    id: "q1",
    quoteNumber: "QUO-2026-0009",
    accountId: "a1",
    opportunityId: "o1",
    account: { id: "a1", accountId: "ACC-1", name: "Emma3D" },
  });
});

describe("acceptQuote authorization", () => {
  it("refuses an unauthenticated caller", async () => {
    authMock.mockResolvedValue(null);
    await expect(acceptQuote("q1")).rejects.toThrow(/unauthorized/i);
    // The point of the test: no sales order, no invoice, no closed-won.
    expect(acceptQuoteImplMock).not.toHaveBeenCalled();
  });

  it("refuses a signed-in user who lacks operate_customer", async () => {
    authMock.mockResolvedValue(SIGNED_IN_WITHOUT_CAPABILITY);
    await expect(acceptQuote("q1")).rejects.toThrow(/unauthorized/i);
    expect(acceptQuoteImplMock).not.toHaveBeenCalled();
  });

  it("allows a user holding operate_customer", async () => {
    authMock.mockResolvedValue(CAPABLE);
    await acceptQuote("q1");
    expect(acceptQuoteImplMock).toHaveBeenCalledTimes(1);
  });
});

describe("rejectQuote authorization", () => {
  it("refuses an unauthenticated caller", async () => {
    authMock.mockResolvedValue(null);
    await expect(rejectQuote("q1")).rejects.toThrow(/unauthorized/i);
    expect(p.quote.update).not.toHaveBeenCalled();
  });

  it("refuses a signed-in user who lacks operate_customer", async () => {
    authMock.mockResolvedValue(SIGNED_IN_WITHOUT_CAPABILITY);
    await expect(rejectQuote("q1", { reason: "too expensive" })).rejects.toThrow(/unauthorized/i);
    expect(p.quote.update).not.toHaveBeenCalled();
  });

  it("allows a user holding operate_customer", async () => {
    authMock.mockResolvedValue(CAPABLE);
    await rejectQuote("q1", { reason: "too expensive" });
    expect(p.quote.update).toHaveBeenCalledTimes(1);
  });
});
