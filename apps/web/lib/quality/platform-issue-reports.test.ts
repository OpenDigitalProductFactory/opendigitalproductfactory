import { describe, expect, it, vi, beforeEach } from "vitest";

// Hoisted Prisma mock — must be declared before the import under test
const prismaMock = vi.hoisted(() => ({
  platformIssueReport: { create: vi.fn() },
  portfolio: { findUnique: vi.fn() },
  digitalProduct: { findUnique: vi.fn() },
}));

vi.mock("@dpf/db", () => ({ prisma: prismaMock }));

import { createPlatformIssueReport } from "./platform-issue-reports";
import { ISSUE_REPORT_STATUS } from "./issue-report-status";

beforeEach(() => {
  prismaMock.platformIssueReport.create.mockReset();
  prismaMock.portfolio.findUnique.mockReset();
  prismaMock.digitalProduct.findUnique.mockReset();
  prismaMock.platformIssueReport.create.mockResolvedValue({});
  prismaMock.digitalProduct.findUnique.mockResolvedValue({ id: "dp-portal" });
});

describe("createPlatformIssueReport", () => {
  it("generates a PIR-XXXXX reportId", async () => {
    const result = await createPlatformIssueReport({
      type: "user_report",
      title: "Test",
      source: "manual",
    });
    expect(result.reportId).toMatch(/^PIR-[A-Z0-9]{5}$/);
    const createArgs = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(createArgs?.data.reportId).toBe(result.reportId);
  });

  it("defaults status to OPEN when not provided", async () => {
    await createPlatformIssueReport({
      type: "user_report",
      title: "Test",
      source: "manual",
    });
    const createArgs = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(createArgs?.data.status).toBeUndefined();
    // status defaults via Prisma schema default("open"); writer must not override
  });

  it("accepts a status from ISSUE_REPORT_STATUS", async () => {
    await createPlatformIssueReport({
      type: "user_report",
      title: "Test",
      source: "manual",
      status: ISSUE_REPORT_STATUS.SUPPORT_TRIAGE,
    });
    const createArgs = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(createArgs?.data.status).toBe("support_triage");
  });

  it("rejects an unknown status", async () => {
    await expect(
      createPlatformIssueReport({
        type: "user_report",
        title: "Test",
        source: "manual",
        status: "bogus" as never,
      }),
    ).rejects.toThrow(/unknown status/i);
  });

  it("truncates title to 500 chars", async () => {
    await createPlatformIssueReport({
      type: "user_report",
      title: "x".repeat(600),
      source: "manual",
    });
    const createArgs = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(createArgs?.data.title.length).toBe(500);
  });

  it("truncates description to 10000 chars", async () => {
    await createPlatformIssueReport({
      type: "user_report",
      title: "Test",
      source: "manual",
      description: "x".repeat(15000),
    });
    const createArgs = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(createArgs?.data.description.length).toBe(10000);
  });

  it("truncates errorStack to 20000 chars", async () => {
    await createPlatformIssueReport({
      type: "runtime_error",
      title: "Test",
      source: "crash_boundary",
      errorStack: "x".repeat(25000),
    });
    const createArgs = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(createArgs?.data.errorStack.length).toBe(20000);
  });

  it("truncates routeContext, userAgent, type, source, severity", async () => {
    await createPlatformIssueReport({
      type: "x".repeat(60),
      severity: "x".repeat(30),
      title: "Test",
      source: "x".repeat(50),
      routeContext: "x".repeat(600),
      userAgent: "x".repeat(600),
    });
    const args = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(args?.data.type.length).toBe(50);
    expect(args?.data.severity.length).toBe(20);
    expect(args?.data.source.length).toBe(30);
    expect(args?.data.routeContext.length).toBe(500);
    expect(args?.data.userAgent.length).toBe(500);
  });

  it("resolves digitalProductId to dpf-portal when not provided", async () => {
    await createPlatformIssueReport({
      type: "user_report",
      title: "Test",
      source: "manual",
    });
    expect(prismaMock.digitalProduct.findUnique).toHaveBeenCalledWith({
      where: { productId: "dpf-portal" },
      select: { id: true },
    });
    const args = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(args?.data.digitalProductId).toBe("dp-portal");
  });

  it("does NOT re-resolve digitalProductId when caller provides one", async () => {
    await createPlatformIssueReport({
      type: "user_report",
      title: "Test",
      source: "manual",
      digitalProductId: "dp-other",
    });
    expect(prismaMock.digitalProduct.findUnique).not.toHaveBeenCalled();
    const args = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(args?.data.digitalProductId).toBe("dp-other");
  });

  it("resolves portfolioId from routeContext when not provided", async () => {
    prismaMock.portfolio.findUnique.mockResolvedValue({ id: "pf-platform" });
    await createPlatformIssueReport({
      type: "user_report",
      title: "Test",
      source: "manual",
      routeContext: "/platform/ai/providers",
    });
    expect(prismaMock.portfolio.findUnique).toHaveBeenCalledWith({
      where: { slug: "foundational" },
      select: { id: true },
    });
    const args = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(args?.data.portfolioId).toBe("pf-platform");
  });

  it("does NOT resolve portfolioId when caller provides one", async () => {
    await createPlatformIssueReport({
      type: "user_report",
      title: "Test",
      source: "manual",
      routeContext: "/platform/ai/providers",
      portfolioId: "pf-explicit",
    });
    expect(prismaMock.portfolio.findUnique).not.toHaveBeenCalled();
    const args = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(args?.data.portfolioId).toBe("pf-explicit");
  });

  it("passes through threadId / taskRunId / featureBuildId / reportedById", async () => {
    await createPlatformIssueReport({
      type: "user_report",
      title: "Test",
      source: "manual",
      reportedById: "u-1",
      threadId: "t-1",
      taskRunId: "tr-1",
      featureBuildId: "fb-1",
    });
    const args = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(args?.data.reportedById).toBe("u-1");
    expect(args?.data.threadId).toBe("t-1");
    expect(args?.data.taskRunId).toBe("tr-1");
    expect(args?.data.featureBuildId).toBe("fb-1");
  });

  it("returns { reportId } on success", async () => {
    const result = await createPlatformIssueReport({
      type: "user_report",
      title: "Test",
      source: "manual",
    });
    expect(result).toEqual({ reportId: expect.stringMatching(/^PIR-/) });
  });
});
