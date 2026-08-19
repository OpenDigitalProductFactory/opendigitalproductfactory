import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent } from "undici";

import {
  StripeApiError,
  listStripeCustomers,
  listStripeInvoices,
  listStripePaymentIntents,
  probeStripeAccount,
  resolveStripeApiBaseUrl,
} from "./client";

describe("resolveStripeApiBaseUrl", () => {
  const original = process.env.STRIPE_API_BASE_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.STRIPE_API_BASE_URL;
    } else {
      process.env.STRIPE_API_BASE_URL = original;
    }
  });

  it("defaults to the canonical Stripe API host", () => {
    delete process.env.STRIPE_API_BASE_URL;
    expect(resolveStripeApiBaseUrl()).toBe("https://api.stripe.com");
  });

  it("honors an explicit harness override", () => {
    process.env.STRIPE_API_BASE_URL = "http://integration-test-harness:8700";
    expect(resolveStripeApiBaseUrl()).toBe("http://integration-test-harness:8700");
  });
});

describe("Stripe client", () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
  });

  afterEach(async () => {
    await mockAgent.close();
  });

  it("probes balance and recent finance objects", async () => {
    const pool = mockAgent.get("https://api.stripe.com");
    pool.intercept({ path: "/v1/balance", method: "GET" }).reply(200, {
      object: "balance",
      livemode: false,
      available: [{ amount: 275000, currency: "usd" }],
      pending: [{ amount: 12000, currency: "usd" }],
    });
    pool.intercept({ path: "/v1/customers?limit=5", method: "GET" }).reply(200, {
      object: "list",
      data: [
        { id: "cus_123", name: "Acme Managed IT", email: "billing@acme.example" },
      ],
    });
    pool.intercept({ path: "/v1/invoices?limit=5", method: "GET" }).reply(200, {
      object: "list",
      data: [
        { id: "in_123", number: "INV-2026-001", status: "open", amount_due: 125000, currency: "usd" },
      ],
    });
    pool.intercept({ path: "/v1/payment_intents?limit=5", method: "GET" }).reply(200, {
      object: "list",
      data: [
        { id: "pi_123", amount: 125000, currency: "usd", status: "requires_payment_method", description: "Managed services retainer" },
      ],
    });

    const result = await probeStripeAccount({
      secretKey: "sk_test_123",
      dispatcher: mockAgent,
    });

    expect(result.balance.livemode).toBe(false);
    expect(result.recentCustomers[0]?.name).toBe("Acme Managed IT");
    expect(result.recentInvoices[0]?.number).toBe("INV-2026-001");
    expect(result.recentPaymentIntents[0]?.id).toBe("pi_123");
  });

  it("supports list helpers with caller-supplied limits", async () => {
    const pool = mockAgent.get("https://api.stripe.com");
    pool.intercept({ path: "/v1/customers?limit=3", method: "GET" }).reply(200, {
      object: "list",
      data: [
        { id: "cus_123", name: "Acme Managed IT" },
        { id: "cus_456", name: "Northwind Services" },
      ],
    });
    pool.intercept({ path: "/v1/invoices?limit=2", method: "GET" }).reply(200, {
      object: "list",
      data: [
        { id: "in_123", number: "INV-2026-001", amount_due: 125000, currency: "usd", status: "open" },
      ],
    });
    pool.intercept({ path: "/v1/payment_intents?limit=4", method: "GET" }).reply(200, {
      object: "list",
      data: [
        { id: "pi_123", amount: 125000, currency: "usd", status: "succeeded" },
      ],
    });

    const customers = await listStripeCustomers({
      secretKey: "sk_test_123",
      limit: 3,
      dispatcher: mockAgent,
    });
    const invoices = await listStripeInvoices({
      secretKey: "sk_test_123",
      limit: 2,
      dispatcher: mockAgent,
    });
    const paymentIntents = await listStripePaymentIntents({
      secretKey: "sk_test_123",
      limit: 4,
      dispatcher: mockAgent,
    });

    expect(customers).toHaveLength(2);
    expect(invoices[0]?.number).toBe("INV-2026-001");
    expect(paymentIntents[0]?.status).toBe("succeeded");
  });

  it("redacts auth failures", async () => {
    mockAgent
      .get("https://api.stripe.com")
      .intercept({ path: "/v1/balance", method: "GET" })
      .reply(401, { error: { message: "Invalid API Key provided: sk_test_secret" } });

    await expect(
      probeStripeAccount({
        secretKey: "sk_test_secret",
        dispatcher: mockAgent,
      }),
    ).rejects.toThrow(StripeApiError);

    await expect(
      probeStripeAccount({
        secretKey: "sk_test_secret",
        dispatcher: mockAgent,
      }),
    ).rejects.not.toThrow(/sk_test_secret/);
  });
});
