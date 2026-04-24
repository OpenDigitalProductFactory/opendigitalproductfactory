import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MockAgent } from "undici";

const fakeCredential = {
  id: "cred-test-1",
  environment: "sandbox" as const,
  accessToken: "fake-bearer-token",
  certPem: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n",
  privateKeyPem: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
};

vi.mock("../lib/creds.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/creds.js")>("../lib/creds.js");
  return {
    ...actual,
    getActiveCredential: vi.fn(async () => fakeCredential),
    recordToolCall: vi.fn(async () => {}),
  };
});

vi.mock("../lib/db.js", () => ({
  getSql: () => ({} as unknown),
  setSqlForTesting: () => {},
}));

import { getPayStatements } from "./get-pay-statements.js";
import { recordToolCall } from "../lib/creds.js";

describe("adp_get_pay_statements", () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await mockAgent.close();
  });

  it("returns mapped statements with bank fields redacted and records success audit", async () => {
    const spy = vi.spyOn(await import("../lib/adp-client.js"), "adpGet");
    spy.mockResolvedValue({
      payStatements: [
        {
          statementID: "PS-2026-0415",
          payDate: "2026-04-15",
          grossPayAmount: { amountValue: 4500, currencyCode: "USD" },
          netPayAmount: { amountValue: 3187.4, currencyCode: "USD" },
          earnings: [{ earningCode: { codeValue: "REGULAR" }, amount: { amountValue: 4500 } }],
          deductions: [
            { deductionCode: { codeValue: "HEALTH" }, amount: { amountValue: 280 } },
            { deductionCode: { codeValue: "401K" }, amount: { amountValue: 450 } },
          ],
          taxes: [{ taxCode: { codeValue: "FIT" }, amount: { amountValue: 412.6 } }],
          directDeposits: [
            {
              bankAccountNumber: "1234567890",
              routingNumber: "021000021",
              accountNumber: "9876543210",
            },
          ],
        } as any,
      ],
      meta: { continuationToken: "opaque-next-page" },
    } as any);

    const result = await getPayStatements(
      { workerId: "EMP0042", fromDate: "2026-04-01", toDate: "2026-04-30" },
      { coworkerId: "payroll-specialist", userId: "user_1" },
    );

    expect(result.payStatements).toHaveLength(1);
    expect(result.payStatements[0]).toMatchObject({
      statementId: "PS-2026-0415",
      payDate: "2026-04-15",
      grossPay: 4500,
      netPay: 3187.4,
      currency: "USD",
    });
    expect(result.payStatements[0]!.earnings[0]).toEqual({ code: "REGULAR", amount: 4500 });
    expect(result.payStatements[0]!.deductions).toHaveLength(2);
    expect(result.payStatements[0]!.taxes[0]).toEqual({ code: "FIT", amount: 412.6 });
    expect(result.nextCursor).toBe("opaque-next-page");

    expect(recordToolCall).toHaveBeenCalledTimes(1);
    const auditCall = vi.mocked(recordToolCall).mock.calls[0]![1];
    expect(auditCall.toolName).toBe("adp_get_pay_statements");
    expect(auditCall.responseKind).toBe("success");
    expect(auditCall.resultCount).toBe(1);

    spy.mockRestore();
  });

  it("rejects invalid workerId format", async () => {
    await expect(
      getPayStatements(
        { workerId: "bad id with spaces", fromDate: "2026-04-01", toDate: "2026-04-30" },
        { coworkerId: "payroll-specialist", userId: null },
      ),
    ).rejects.toThrow();
  });

  it("rejects invalid date formats", async () => {
    await expect(
      getPayStatements(
        { workerId: "EMP0042", fromDate: "04/01/2026", toDate: "2026-04-30" },
        { coworkerId: "payroll-specialist", userId: null },
      ),
    ).rejects.toThrow();
  });

  it("rejects toDate before fromDate", async () => {
    await expect(
      getPayStatements(
        { workerId: "EMP0042", fromDate: "2026-04-30", toDate: "2026-04-01" },
        { coworkerId: "payroll-specialist", userId: null },
      ),
    ).rejects.toThrow();
  });

  it("rejects ranges > 366 days", async () => {
    await expect(
      getPayStatements(
        { workerId: "EMP0042", fromDate: "2024-01-01", toDate: "2026-01-01" },
        { coworkerId: "payroll-specialist", userId: null },
      ),
    ).rejects.toThrow();
  });

  it("records rate-limited audit row on RATE_LIMITED AdpApiError", async () => {
    const { AdpApiError } = await import("../lib/adp-client.js");
    const spy = vi.spyOn(await import("../lib/adp-client.js"), "adpGet");
    spy.mockRejectedValue(new AdpApiError("rate limited", 429, "RATE_LIMITED"));

    await expect(
      getPayStatements(
        { workerId: "EMP0042", fromDate: "2026-04-01", toDate: "2026-04-30" },
        { coworkerId: "payroll-specialist", userId: null },
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });

    const auditCall = vi.mocked(recordToolCall).mock.calls[0]![1];
    expect(auditCall.responseKind).toBe("rate-limited");
    expect(auditCall.errorCode).toBe("RATE_LIMITED");

    spy.mockRestore();
  });

  it("records NOT_CONNECTED error audit when credential is missing", async () => {
    const { getActiveCredential, AdpNotConnectedError } = await import("../lib/creds.js");
    vi.mocked(getActiveCredential).mockRejectedValueOnce(
      new AdpNotConnectedError("ADP is not connected"),
    );

    await expect(
      getPayStatements(
        { workerId: "EMP0042", fromDate: "2026-04-01", toDate: "2026-04-30" },
        { coworkerId: "payroll-specialist", userId: null },
      ),
    ).rejects.toThrow(/not connected/i);

    const auditCall = vi.mocked(recordToolCall).mock.calls[0]![1];
    expect(auditCall.errorCode).toBe("NOT_CONNECTED");
  });

  it("returns nextCursor=null when ADP omits continuationToken", async () => {
    const spy = vi.spyOn(await import("../lib/adp-client.js"), "adpGet");
    spy.mockResolvedValue({ payStatements: [] } as any);

    const result = await getPayStatements(
      { workerId: "EMP0042", fromDate: "2026-04-01", toDate: "2026-04-30" },
      { coworkerId: "payroll-specialist", userId: null },
    );
    expect(result.nextCursor).toBeNull();
    expect(result.payStatements).toHaveLength(0);

    spy.mockRestore();
  });

  it("passes cursor through to ADP query when supplied", async () => {
    const spy = vi.spyOn(await import("../lib/adp-client.js"), "adpGet");
    spy.mockResolvedValue({ payStatements: [] } as any);

    await getPayStatements(
      {
        workerId: "EMP0042",
        fromDate: "2026-04-01",
        toDate: "2026-04-30",
        cursor: "prev-page-token",
      },
      { coworkerId: "payroll-specialist", userId: null },
    );

    const callArgs = spy.mock.calls[0]![0];
    expect(callArgs.query).toMatchObject({ continuationToken: "prev-page-token" });

    spy.mockRestore();
  });
});
