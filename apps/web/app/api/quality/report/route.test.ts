import { describe, expect, it, vi, beforeEach } from "vitest";

const writerMock = vi.hoisted(() => ({
  createPlatformIssueReport: vi.fn(),
}));

vi.mock("@/lib/quality/platform-issue-reports", () => writerMock);

import { POST } from "./route";

beforeEach(() => {
  writerMock.createPlatformIssueReport.mockReset();
  writerMock.createPlatformIssueReport.mockResolvedValue({ reportId: "PIR-TEST1" });
});

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/quality/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/quality/report", () => {
  it("delegates to createPlatformIssueReport with normalized input", async () => {
    const res = await POST(makeReq({
      type: "runtime_error",
      title: "Boom",
      description: "Something broke",
      severity: "high",
      routeContext: "/build/123",
      errorStack: "Error: x",
      userAgent: "Mozilla/5.0",
      source: "crash_boundary",
      userId: "u-9",
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, reportId: "PIR-TEST1" });

    expect(writerMock.createPlatformIssueReport).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "runtime_error",
        title: "Boom",
        description: "Something broke",
        severity: "high",
        routeContext: "/build/123",
        errorStack: "Error: x",
        userAgent: "Mozilla/5.0",
        source: "crash_boundary",
        reportedById: "u-9",
      }),
    );
  });

  it("defaults source to manual when not provided", async () => {
    await POST(makeReq({ type: "user_report", title: "Hi" }));
    const args = writerMock.createPlatformIssueReport.mock.calls[0]?.[0];
    expect(args?.source).toBe("manual");
  });

  it("returns 413 when content-length exceeds 64KiB", async () => {
    const req = new Request("http://localhost/api/quality/report", {
      method: "POST",
      headers: { "Content-Type": "application/json", "content-length": "70000" },
      body: JSON.stringify({ type: "user_report", title: "x" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(writerMock.createPlatformIssueReport).not.toHaveBeenCalled();
  });

  it("returns 500 on writer error", async () => {
    writerMock.createPlatformIssueReport.mockRejectedValue(new Error("db"));
    const res = await POST(makeReq({ type: "user_report", title: "x" }));
    expect(res.status).toBe(500);
  });
});
