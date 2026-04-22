import { describe, expect, it } from "vitest";
import type { IntegrationToolCallLog, Prisma } from "../generated/client";

describe("IntegrationToolCallLog model shape", () => {
  it("accepts a full success row across integrations", () => {
    const adpRow: IntegrationToolCallLog = {
      id: "cuid_1",
      calledAt: new Date(),
      integration: "adp",
      coworkerId: "payroll-specialist",
      userId: "user_abc",
      toolName: "adp_list_workers",
      argsHash: "sha256-hex",
      responseKind: "success",
      resultCount: 42,
      durationMs: 830,
      errorCode: null,
      errorMessage: null,
    };
    expect(adpRow.integration).toBe("adp");

    const qbRow: IntegrationToolCallLog = {
      id: "cuid_2",
      calledAt: new Date(),
      integration: "quickbooks",
      coworkerId: "finance-specialist",
      userId: null,
      toolName: "qb_list_invoices",
      argsHash: "sha256-hex",
      responseKind: "success",
      resultCount: 17,
      durationMs: 410,
      errorCode: null,
      errorMessage: null,
    };
    expect(qbRow.integration).toBe("quickbooks");
  });

  it("accepts an error row with redacted message and no resultCount", () => {
    const errorRow: IntegrationToolCallLog = {
      id: "cuid_3",
      calledAt: new Date(),
      integration: "adp",
      coworkerId: "payroll-specialist",
      userId: "user_abc",
      toolName: "adp_get_pay_statements",
      argsHash: "sha256-hex",
      responseKind: "error",
      resultCount: null,
      durationMs: 120,
      errorCode: "ADP_401",
      errorMessage: "invalid client credentials",
    };
    expect(errorRow.responseKind).toBe("error");
    expect(errorRow.resultCount).toBeNull();
  });

  it("create input requires integration/coworkerId/toolName/argsHash/responseKind/durationMs", () => {
    // Compile-time check: all optional columns may be omitted; required ones cannot.
    const createArgs: Prisma.IntegrationToolCallLogCreateInput = {
      integration: "adp",
      coworkerId: "payroll-specialist",
      toolName: "adp_list_workers",
      argsHash: "sha256-hex",
      responseKind: "success",
      durationMs: 100,
    };
    expect(createArgs.integration).toBe("adp");
  });

  it("where type supports the four indexed query shapes", () => {
    // Shape-level proof that filter combinations compile — these are the four indexes.
    const byCalledAt: Prisma.IntegrationToolCallLogWhereInput = { calledAt: { gte: new Date() } };
    const byIntegration: Prisma.IntegrationToolCallLogWhereInput = {
      integration: "adp",
      calledAt: { gte: new Date() },
    };
    const byCoworker: Prisma.IntegrationToolCallLogWhereInput = {
      coworkerId: "payroll-specialist",
      calledAt: { gte: new Date() },
    };
    const byTool: Prisma.IntegrationToolCallLogWhereInput = {
      toolName: "adp_list_workers",
      calledAt: { gte: new Date() },
    };
    expect([byCalledAt, byIntegration, byCoworker, byTool]).toHaveLength(4);
  });
});
