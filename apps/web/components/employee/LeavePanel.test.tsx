import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { LeavePanel } from "./LeavePanel";

const pending = {
  id: "leave-db-1",
  requestId: "LR-1",
  employeeProfileId: "employee-profile-1",
  employeeName: "Ada Lovelace",
  employeeId: "EMP-1",
  departmentId: "dept-1",
  leaveType: "vacation",
  startDate: "2026-08-20T00:00:00.000Z",
  endDate: "2026-08-21T00:00:00.000Z",
  days: 2,
  reason: null,
  status: "pending",
  approverName: null,
  approvedAt: null,
  rejectionReason: null,
  decisionInteractionId: "DI-1",
  decisionRecommendation: "approve" as const,
  decisionRationale: "Coverage stays above the recorded cushion.",
  decisionGuardReasons: [],
  createdAt: "2026-08-12T00:00:00.000Z",
};

describe("LeavePanel", () => {
  it("shows the recommendation and rationale beside human-only controls", () => {
    const html = renderToStaticMarkup(
      <LeavePanel policies={[]} balances={[]} requests={[]} isManager pendingApprovals={[pending]} />,
    );
    expect(html).toContain("Advisor recommends");
    expect(html).toContain("approve");
    expect(html).toContain("Coverage stays above the recorded cushion.");
    expect(html).toContain("Human decision");
    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
  });

  it("uses token-backed status badges instead of hardcoded leave colours", () => {
    const html = renderToStaticMarkup(
      <LeavePanel policies={[]} balances={[]} requests={[pending]} />,
    );
    expect(html).toContain("data-intent=\"warning\"");
    expect(html).not.toContain("#fb923c");
    expect(html).not.toContain("#f472b6");
  });

  it("shows an honest setup state instead of a non-functional request control", () => {
    const html = renderToStaticMarkup(
      <LeavePanel policies={[]} balances={[]} requests={[]} canRequest={false} />,
    );
    expect(html).toContain("Link an employee profile to request time off.");
    expect(html).not.toContain("Request time off</button>");
  });
});
