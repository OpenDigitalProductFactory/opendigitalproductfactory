// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ApprovalOutcomeHistory } from "./ApprovalOutcomeHistory";
import { projectApprovalOutcome, withApprovalFailureEvidence } from "@/lib/coworker/approval-outcome";
afterEach(cleanup);
const now = new Date("2026-09-27T12:00:00Z");
describe("approval results after a new server render", () => {
  it.each(["executed", "failed", "not-run", "expired"])("shows %s on the exact link without another decision", (state) => {
    const result = projectApprovalOutcome({ id: "e1", status: state === "expired" ? "expired" : "approved", expiresAt: now, createdAt: now, toolExecutions: state === "expired" ? [] : [{ executionMode: "approval-outcome", success: state === "executed", result: { status: state } }] }, now);
    const { container } = render(<ApprovalOutcomeHistory outcomes={[result]} exact />);
    expect(container.querySelector("details")?.open).toBe(true);
    expect(screen.getByText(result.label)).toBeTruthy();
    expect(screen.getByText(result.nextAction)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /authorize|decline/i })).toBeNull();
  });
  it("keeps routine history collapsed with a visible way to open it", () => {
    const result = projectApprovalOutcome({ id: "e1", status: "executed", expiresAt: null, createdAt: now, toolExecutions: [] }, now);
    const { container } = render(<ApprovalOutcomeHistory outcomes={[result]} />);
    expect(container.querySelector("details")?.open).toBe(false);
    expect(screen.getByText("Recent approval results")).toBeTruthy();
  });
  it("does not reveal whether an unavailable ID belongs to another user", () => {
    render(<ApprovalOutcomeHistory outcomes={[]} exact />);
    expect(screen.getByText("This request is not available in your Inbox.")).toBeTruthy();
  });
});

it("explains a proven refusal and offers inspection without another approval or retry", () => {
  const base = projectApprovalOutcome({ id: "e1", status: "failed", expiresAt: now, createdAt: now, toolExecutions: [] }, now);
  const outcome = withApprovalFailureEvidence(base, { state: "available", code: "handoff-transaction-required",
    executionId: "actual-run", executedAtIso: now.toISOString(), threadBinding: "not-recorded",
    roomAccess: "available", roomHref: "/workspace/cases/work-capsule%3AWC-ORIGINAL" });
  const { container } = render(<ApprovalOutcomeHistory outcomes={[outcome]} exact />);
  expect(screen.getByText(/stopped before transfer/)).toBeTruthy();
  expect(screen.getByText(/does not authorize another attempt/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Inspect original Workroom" }).getAttribute("href")).toBe("/workspace/cases/work-capsule%3AWC-ORIGINAL");
  expect(container.querySelectorAll("button")).toHaveLength(0);
  expect(screen.queryByRole("link", { name: /retry|authorize/i })).toBeNull();
});
it("keeps an unproven reason explicit without an invented inspection destination", () => {
  const base = projectApprovalOutcome({ id: "e1", status: "failed", expiresAt: now, createdAt: now, toolExecutions: [] }, now);
  const outcome = withApprovalFailureEvidence(base, { state: "missing", reason: "execution-missing" });
  render(<ApprovalOutcomeHistory outcomes={[outcome]} exact />);
  expect(screen.getByText(/reason could not be confirmed/)).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Inspect original Workroom" })).toBeNull();
});
