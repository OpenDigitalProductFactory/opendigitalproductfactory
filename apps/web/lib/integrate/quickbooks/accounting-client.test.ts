import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent } from "undici";

import {
  QuickBooksAccountingError,
  getQuickBooksInvoice,
  listQuickBooksCustomers,
  listQuickBooksInvoices,
  probeQuickBooksAccounting,
  resolveAccountingBaseUrl,
} from "./accounting-client";

describe("resolveAccountingBaseUrl", () => {
  const original = process.env.QUICKBOOKS_API_BASE_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.QUICKBOOKS_API_BASE_URL;
    } else {
      process.env.QUICKBOOKS_API_BASE_URL = original;
    }
  });

  it("maps sandbox to the sandbox accounting host", () => {
    delete process.env.QUICKBOOKS_API_BASE_URL;
    expect(resolveAccountingBaseUrl("sandbox")).toBe("https://sandbox-quickbooks.api.intuit.com");
  });

  it("maps production to the production accounting host", () => {
    delete process.env.QUICKBOOKS_API_BASE_URL;
    expect(resolveAccountingBaseUrl("production")).toBe("https://quickbooks.api.intuit.com");
  });

  it("honors an explicit base URL override for harness tests", () => {
    process.env.QUICKBOOKS_API_BASE_URL = "http://integration-test-harness:8700";
    expect(resolveAccountingBaseUrl("sandbox")).toBe("http://integration-test-harness:8700");
  });
});

describe("probeQuickBooksAccounting", () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
  });

  afterEach(async () => {
    await mockAgent.close();
  });

  it("returns company info plus sample customer and invoice results", async () => {
    const pool = mockAgent.get("https://sandbox-quickbooks.api.intuit.com");
    pool
      .intercept({
        path: "/v3/company/9130355377388383/companyinfo/9130355377388383",
        method: "GET",
      })
      .reply(200, {
        CompanyInfo: {
          CompanyName: "Acme Services LLC",
          Country: "US",
        },
      });
    pool
      .intercept({
        path: (value) =>
          value.startsWith("/v3/company/9130355377388383/query?") &&
          decodeURIComponent(value.replace(/\+/g, "%20")).includes(
            "select * from Customer maxresults 1",
          ),
        method: "GET",
      })
      .reply(200, {
        QueryResponse: {
          Customer: [{ Id: "42", DisplayName: "Acme Managed IT" }],
        },
      });
    pool
      .intercept({
        path: (value) =>
          value.startsWith("/v3/company/9130355377388383/query?") &&
          decodeURIComponent(value.replace(/\+/g, "%20")).includes(
            "select * from Invoice maxresults 1",
          ),
        method: "GET",
      })
      .reply(200, {
        QueryResponse: {
          Invoice: [{ Id: "9001", DocNumber: "INV-9001" }],
        },
      });

    const result = await probeQuickBooksAccounting({
      environment: "sandbox",
      realmId: "9130355377388383",
      accessToken: "access-token-123",
      dispatcher: mockAgent,
    });

    expect(result.companyInfo.CompanyName).toBe("Acme Services LLC");
    expect(result.sampleCustomer?.DisplayName).toBe("Acme Managed IT");
    expect(result.sampleInvoice?.DocNumber).toBe("INV-9001");
  });

  it("throws a redacted accounting error on unauthorized access", async () => {
    mockAgent
      .get("https://sandbox-quickbooks.api.intuit.com")
      .intercept({
        path: "/v3/company/9130355377388383/companyinfo/9130355377388383",
        method: "GET",
      })
      .reply(401, { Fault: { Error: [{ Message: "AuthenticationFailed" }] } });

    await expect(
      probeQuickBooksAccounting({
        environment: "sandbox",
        realmId: "9130355377388383",
        accessToken: "secret-access-token",
        dispatcher: mockAgent,
      }),
    ).rejects.toThrow(QuickBooksAccountingError);

    await expect(
      probeQuickBooksAccounting({
        environment: "sandbox",
        realmId: "9130355377388383",
        accessToken: "secret-access-token",
        dispatcher: mockAgent,
      }),
    ).rejects.not.toThrow(/secret-access-token/);
  });

  it("lists customers with a caller-supplied limit", async () => {
    const pool = mockAgent.get("https://sandbox-quickbooks.api.intuit.com");
    pool
      .intercept({
        path: (value) =>
          value.startsWith("/v3/company/9130355377388383/query?") &&
          decodeURIComponent(value.replace(/\+/g, "%20")).includes(
            "select * from Customer maxresults 3",
          ),
        method: "GET",
      })
      .reply(200, {
        QueryResponse: {
          Customer: [
            { Id: "42", DisplayName: "Acme Managed IT" },
            { Id: "84", DisplayName: "Northwind Services" },
          ],
        },
      });

    const result = await listQuickBooksCustomers({
      environment: "sandbox",
      realmId: "9130355377388383",
      accessToken: "access-token-123",
      limit: 3,
      dispatcher: mockAgent,
    });

    expect(result).toEqual([
      { Id: "42", DisplayName: "Acme Managed IT" },
      { Id: "84", DisplayName: "Northwind Services" },
    ]);
  });

  it("lists invoices and can fetch a detailed invoice record", async () => {
    const pool = mockAgent.get("https://sandbox-quickbooks.api.intuit.com");
    pool
      .intercept({
        path: (value) =>
          value.startsWith("/v3/company/9130355377388383/query?") &&
          decodeURIComponent(value.replace(/\+/g, "%20")).includes(
            "select * from Invoice maxresults 2",
          ),
        method: "GET",
      })
      .reply(200, {
        QueryResponse: {
          Invoice: [
            { Id: "9001", DocNumber: "INV-9001", TotalAmt: 1250, Balance: 1250 },
            { Id: "9002", DocNumber: "INV-9002", TotalAmt: 320, Balance: 0 },
          ],
        },
      });
    pool
      .intercept({
        path: "/v3/company/9130355377388383/invoice/9001",
        method: "GET",
      })
      .reply(200, {
        Invoice: {
          Id: "9001",
          DocNumber: "INV-9001",
          TotalAmt: 1250,
          Balance: 1250,
          CustomerRef: { value: "42", name: "Acme Managed IT" },
          PrivateNote: "Monthly managed services retainer.",
        },
      });

    const invoices = await listQuickBooksInvoices({
      environment: "sandbox",
      realmId: "9130355377388383",
      accessToken: "access-token-123",
      limit: 2,
      dispatcher: mockAgent,
    });
    const invoice = await getQuickBooksInvoice({
      environment: "sandbox",
      realmId: "9130355377388383",
      accessToken: "access-token-123",
      invoiceId: "9001",
      dispatcher: mockAgent,
    });

    expect(invoices).toHaveLength(2);
    expect(invoices[0]?.DocNumber).toBe("INV-9001");
    expect(invoice.CustomerRef?.name).toBe("Acme Managed IT");
    expect(invoice.PrivateNote).toBe("Monthly managed services retainer.");
  });
});
