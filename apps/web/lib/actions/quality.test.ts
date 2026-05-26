import { describe, expect, it, vi, beforeEach } from "vitest";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
const writerMock = vi.hoisted(() => ({ createPlatformIssueReport: vi.fn() }));

vi.mock("@/lib/auth", () => authMock);
vi.mock("@/lib/quality/platform-issue-reports", () => writerMock);
vi.mock("@dpf/db", () => ({ prisma: {} })); // unused after migration

import { reportQualityIssue } from "./quality";

beforeEach(() => {
  authMock.auth.mockReset();
  writerMock.createPlatformIssueReport.mockReset();
  writerMock.createPlatformIssueReport.mockResolvedValue({ reportId: "PIR-Q1" });
});

describe("reportQualityIssue", () => {
  it("resolves userId from auth and delegates to writer", async () => {
    authMock.auth.mockResolvedValue({ user: { id: "u-1" } });

    const result = await reportQualityIssue({
      type: "user_report",
      title: "Hello",
      routeContext: "/platform",
      severity: "medium",
    });

    expect(result).toEqual({ reportId: "PIR-Q1" });
    expect(writerMock.createPlatformIssueReport).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "user_report",
        title: "Hello",
        routeContext: "/platform",
        severity: "medium",
        reportedById: "u-1",
        source: "ai_assisted",
      }),
    );
  });

  it("uses null reportedById when no session", async () => {
    authMock.auth.mockResolvedValue(null);
    await reportQualityIssue({
      type: "feedback",
      title: "x",
      routeContext: "/admin",
    });
    const args = writerMock.createPlatformIssueReport.mock.calls[0]?.[0];
    expect(args?.reportedById).toBeNull();
  });

  it("returns { error } when writer throws", async () => {
    authMock.auth.mockResolvedValue(null);
    writerMock.createPlatformIssueReport.mockRejectedValue(new Error("db"));
    const result = await reportQualityIssue({
      type: "user_report",
      title: "x",
      routeContext: "/admin",
    });
    expect(result).toEqual({ error: "Failed to create report" });
  });
});
