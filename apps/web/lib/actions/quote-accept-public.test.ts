import { beforeEach, describe, expect, it, vi } from "vitest";

const { acceptQuoteMock } = vi.hoisted(() => ({ acceptQuoteMock: vi.fn() }));
// The public flow calls the IMPL, bypassing acceptQuote's internal capability
// guard on purpose — token possession is the authority (BI-1017777D).
vi.mock("@/lib/actions/crm-quote-acceptance", () => ({ acceptQuoteImpl: acceptQuoteMock }));

vi.mock("@dpf/db", () => ({
  prisma: {
    quote: { findUnique: vi.fn() },
    activity: { create: vi.fn().mockResolvedValue({}) },
  },
}));

import { prisma } from "@dpf/db";
import { acceptQuoteByToken, getQuoteByAcceptToken } from "./quote-accept-public";

const p = prisma as unknown as {
  quote: { findUnique: ReturnType<typeof vi.fn> };
  activity: { create: ReturnType<typeof vi.fn> };
};

const sentQuote = {
  id: "q1",
  status: "sent",
  validUntil: new Date(Date.now() + 7 * 86400_000),
  quoteNumber: "QUO-2026-0009",
  accountId: "a1",
  opportunityId: "o1",
};

beforeEach(() => {
  vi.clearAllMocks();
  p.quote.findUnique.mockResolvedValue(sentQuote);
  acceptQuoteMock.mockResolvedValue({});
});

describe("acceptQuoteByToken", () => {
  it("accepts a sent, in-date quote and records the acceptor on the timeline", async () => {
    const res = await acceptQuoteByToken({ token: "t".repeat(32), acceptedByName: "Ian Pruden", acceptedByEmail: "Ian@Emma3D.com" });
    expect(acceptQuoteMock).toHaveBeenCalledWith("q1", undefined, expect.any(Function));
    const act = p.activity.create.mock.calls[0][0].data;
    expect(act.subject).toContain("Ian Pruden");
    expect(act.subject).toContain("ian@emma3d.com");
    expect(res).toEqual({ ok: true, alreadyAccepted: false });
  });

  it("is idempotent for an already-accepted quote", async () => {
    p.quote.findUnique.mockResolvedValue({ ...sentQuote, status: "accepted" });
    const res = await acceptQuoteByToken({ token: "t".repeat(32), acceptedByName: "Ian", acceptedByEmail: "i@e.com" });
    expect(res.alreadyAccepted).toBe(true);
    expect(acceptQuoteMock).not.toHaveBeenCalled();
  });

  it("rejects drafts, expired quotes, bad tokens, and missing identity", async () => {
    p.quote.findUnique.mockResolvedValue({ ...sentQuote, status: "draft" });
    await expect(acceptQuoteByToken({ token: "t".repeat(32), acceptedByName: "I", acceptedByEmail: "i@e.com" })).rejects.toThrow(/no longer open/i);

    p.quote.findUnique.mockResolvedValue({ ...sentQuote, validUntil: new Date(Date.now() - 86400_000) });
    await expect(acceptQuoteByToken({ token: "t".repeat(32), acceptedByName: "I", acceptedByEmail: "i@e.com" })).rejects.toThrow(/expired/i);

    p.quote.findUnique.mockResolvedValue(null);
    await expect(acceptQuoteByToken({ token: "t".repeat(32), acceptedByName: "I", acceptedByEmail: "i@e.com" })).rejects.toThrow(/not valid/i);

    await expect(acceptQuoteByToken({ token: "t".repeat(32), acceptedByName: "", acceptedByEmail: "nope" })).rejects.toThrow(/required/i);
  });
});

describe("getQuoteByAcceptToken", () => {
  it("refuses trivially short tokens without touching the database", async () => {
    const res = await getQuoteByAcceptToken("short");
    expect(res).toBeNull();
    expect(p.quote.findUnique).not.toHaveBeenCalled();
  });
});
