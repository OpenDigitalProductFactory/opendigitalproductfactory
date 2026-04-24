import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockAgent } from "undici";

const { mockUpsert } = vi.hoisted(() => ({ mockUpsert: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: { integrationCredential: { upsert: mockUpsert } },
}));

import { connectStripe } from "./connect-action";

describe("connectStripe", () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockUpsert.mockReset();
    mockUpsert.mockResolvedValue({});
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
  });

  it("persists a connected Stripe credential row from a successful read-first probe", async () => {
    const pool = mockAgent.get("https://api.stripe.com");
    pool.intercept({ path: "/v1/balance", method: "GET" }).reply(200, {
      object: "balance",
      livemode: false,
      available: [{ amount: 275000, currency: "usd" }],
      pending: [{ amount: 12000, currency: "usd" }],
    });
    pool.intercept({ path: "/v1/customers?limit=5", method: "GET" }).reply(200, {
      object: "list",
      data: [{ id: "cus_123", name: "Acme Managed IT", email: "billing@acme.example" }],
    });
    pool.intercept({ path: "/v1/invoices?limit=5", method: "GET" }).reply(200, {
      object: "list",
      data: [{ id: "in_123", number: "INV-2026-001", status: "open", amount_due: 125000, currency: "usd" }],
    });
    pool.intercept({ path: "/v1/payment_intents?limit=5", method: "GET" }).reply(200, {
      object: "list",
      data: [{ id: "pi_123", amount: 125000, currency: "usd", status: "requires_payment_method" }],
    });

    const result = await connectStripe({ secretKey: "sk_test_123" }, { dispatcher: mockAgent });

    expect(result).toMatchObject({
      ok: true,
      status: "connected",
      mode: "test",
    });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where.integrationId).toBe("stripe-billing-payments");
    expect(call.create.provider).toBe("stripe");
    expect(call.create.status).toBe("connected");
    expect(call.create.fieldsEnc).toBeTypeOf("string");
    expect(call.create.tokenCacheEnc).toBeNull();
  });

  it("rejects invalid input without persisting", async () => {
    const result = await connectStripe({ secretKey: "" }, { dispatcher: mockAgent });

    expect(result).toMatchObject({ ok: false, status: "error", statusCode: 400 });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("persists a redacted error on invalid credentials", async () => {
    mockAgent
      .get("https://api.stripe.com")
      .intercept({ path: "/v1/balance", method: "GET" })
      .reply(401, { error: { message: "Invalid API Key provided: sk_test_super_secret" } });

    const result = await connectStripe(
      { secretKey: "sk_test_super_secret" },
      { dispatcher: mockAgent },
    );

    expect(result).toMatchObject({ ok: false, status: "error", statusCode: 400 });
    if (!result.ok) {
      expect(result.error).not.toContain("sk_test_super_secret");
    }

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.status).toBe("error");
    expect(call.create.lastErrorMsg).not.toContain("sk_test_super_secret");
  });
});
