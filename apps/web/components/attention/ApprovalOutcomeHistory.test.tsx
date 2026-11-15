// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ApprovalOutcomeHistory } from "./ApprovalOutcomeHistory";
import { projectApprovalOutcome, withApprovalFailureEvidence, withApprovalRuntimeEvidence } from "@/lib/coworker/approval-outcome";
afterEach(cleanup);
const now = new Date("2026-09-27T12:00:00Z");
describe("approval results after a new server render", () => {
  it("retains safe saved classifications after a fresh render, without a retry action", () => {
    const base = projectApprovalOutcome({ id: "saved-report", status: "executed", expiresAt: null, createdAt: now, toolExecutions: [] }, now);
    const outcome = { ...base, serviceReportExplanation: "Saved service check. Recovery is not confirmed.", serviceReportEvidence: {
      state: "available" as const, executionId: "original-check", executedAtIso: now.toISOString(), toolName: "admin_run_command" as const,
      operation: "service-convergence-shadow" as const, threadBinding: "not-recorded" as const,
      report: { mode: "shadow" as const, targetSha: "a".repeat(40), observedAtIso: now.toISOString(), outcome: "current" as const,
        classifications: { wouldRecreate: [], unchanged: ["postgres"], skippedStopped: [], dataOwnerChanged: [], unclassified: [], failed: [], bindDrift: ["portal-tls"] } } } };
    const { container, unmount } = render(<ApprovalOutcomeHistory outcomes={[outcome]} exact />);
    expect(screen.getByText("postgres")).toBeTruthy(); expect(screen.getByText("portal-tls")).toBeTruthy();
    expect(container.querySelectorAll("button")).toHaveLength(0); unmount();
    render(<ApprovalOutcomeHistory outcomes={[outcome]} exact />);
    expect(screen.getByText(/Recovery is not confirmed/)).toBeTruthy(); expect(screen.getByText("postgres")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /retry|run|authorize/i })).toBeNull();
  });
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

it("explains an unsettled runtime result after a new render without offering retry or disclosing payload", () => {
  const base = projectApprovalOutcome({ id: "e1", status: "failed", expiresAt: now, createdAt: now, toolExecutions: [] }, now);
  const outcome = withApprovalRuntimeEvidence(base, { state: "available", executionId: "original-runtime-execution",
    executedAtIso: now.toISOString(), toolName: "reconcile_runtime_capabilities", operation: "reconciliation",
    transitionId: "RCT-original-fixture", outcome: "incomplete", operationStatus: "host_applied_pending_verification",
    failureCode: null, threadBinding: "not-recorded", hostEvidence: { state: "unavailable", receiptVerification: "unproven" } });
  const { container, unmount } = render(<ApprovalOutcomeHistory outcomes={[outcome]} exact />);
  expect(screen.getByText(/original change is not settled/)).toBeTruthy();
  expect(screen.getByText(/reconcile the original result/)).toBeTruthy();
  expect(screen.getByText(/RCT-original-fixture/)).toBeTruthy();
  expect(screen.getByText(/Host result not verified/)).toBeTruthy();
  expect(container.querySelectorAll("button")).toHaveLength(0);
  expect(screen.queryByRole("link", { name: /retry|authorize/i })).toBeNull();
  unmount(); render(<ApprovalOutcomeHistory outcomes={[outcome]} exact />);
  expect(screen.getByText(/original change is not settled/)).toBeTruthy();
});

it("keeps a recorded recovery requirement distinct from completed restoration", () => {
  const base = projectApprovalOutcome({ id: "e1", status: "failed", expiresAt: now, createdAt: now, toolExecutions: [] }, now);
  const outcome = withApprovalRuntimeEvidence(base, { state: "available", executionId: "original-runtime-execution",
    executedAtIso: now.toISOString(), toolName: "reconcile_runtime_capabilities", operation: "reconciliation",
    transitionId: "RCT-original-fixture", outcome: "failed", operationStatus: "rollback_failed", failureCode: null,
    threadBinding: "matched", hostEvidence: { state: "recorded", status: "rollback_failed", receiptVerification: "unproven", receiptStatus: null, recoveryRequired: "recorded" } });
  render(<ApprovalOutcomeHistory outcomes={[outcome]} exact />);
  expect(screen.getByText(/Restoration is not confirmed/)).toBeTruthy();
  expect(screen.getByText(/reconcile the original recovery/)).toBeTruthy();
});
