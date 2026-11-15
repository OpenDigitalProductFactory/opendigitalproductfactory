// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeatureBuildRow } from "@/lib/feature-build-types";
import { ReviewPanel } from "./ReviewPanel";
vi.mock("@/lib/actions/local-format", () => ({ formatText: async (text: string) => text }));
vi.mock("@/components/deliberation/DeliberationSummaryCard", () => ({ DeliberationSummaryCard: () => null }));
vi.mock("@/components/build/DecompositionCoordinator", () => ({ DecompositionCoordinator: () => null }));
afterEach(cleanup);
function show(value: unknown) {
  render(<ReviewPanel build={{ buildId: "FB-FIXTURE", title: "Saved verification fixture", verificationOut: JSON.parse(JSON.stringify(value)),
    taskResults: null, brief: null, designDoc: null, designReview: null, buildPlan: null, planReview: null,
    acceptanceMet: null, diffSummary: null, diffPatch: null, uxTestResults: null, uxVerificationStatus: null,
  } as unknown as FeatureBuildRow} />);
}
const observed = { typecheckPassed: true, testsPassed: 4, testsFailed: 0, testsExecuted: true,
  testsApplicable: true, testCommandPassed: true, testSummariesComplete: true };
describe("ReviewPanel saved verification", () => {
  it("does not show a historical corrupt no-test counter as a pass", () => {
    show({ typecheckPassed: true, testsPassed: 1, testsFailed: 0, testsExecuted: false, testsApplicable: null, scope: "none" });
    expect(screen.getByText("Unverified", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("No tests ran.")).toBeInTheDocument();
    expect(screen.queryByText("1 passed", { exact: true })).not.toBeInTheDocument();
  });
  it("shows an unknown typecheck as not verified, without zero errors", () => {
    show({ typecheckPassed: null, testsPassed: 0, testsFailed: 0, testsExecuted: false, testsApplicable: null });
    expect(screen.getByText("Not verified", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("0 errors", { exact: true })).not.toBeInTheDocument();
  });
  it("retains actual observed counts and exposes the full conflicting report after reload", () => {
    const content = `${"Retained QA detail ".repeat(200)}END-OF-RETAINED-QA`;
    show({ ...observed, testEvidenceConflict: true, reportedQa: { testsPassed: 99, testsFailed: 3, content },
      fullOutput: "Tests 4 passed", testCommands: ["fixture scoped test command"],
      verificationSource: { workdir: "/isolated", baseRef: "fixture-base", digest: "a".repeat(64), unchanged: true, checkedAt: "2026-11-11T00:00:00Z" } });
    expect(screen.getByText("Unverified", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/Earlier reported test failures remain unresolved/)).toBeInTheDocument();
    expect(screen.getByText(/4 passes observed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show raw output" }));
    expect(screen.getByText(/END-OF-RETAINED-QA/)).toBeInTheDocument();
    expect(screen.getByText(/fixture scoped test command/)).toBeInTheDocument();
    expect(screen.getByText(/fixture-base/)).toBeInTheDocument();
  });
  it("distinguishes a confirmed exemption without claiming executed cases", () => {
    show({ typecheckPassed: true, testsPassed: 0, testsFailed: 0, testsExecuted: false, testsApplicable: false });
    expect(screen.getByText("Typecheck only", { exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Verification/ }));
    expect(screen.getByText("Not applicable; no tests ran.")).toBeInTheDocument();
  });
  it("shows a qualified observed pass and actual failures distinctly", () => {
    show(observed);
    expect(screen.getByText("Passed", { exact: true })).toBeInTheDocument();
    cleanup();
    show({ ...observed, testsPassed: 3, testsFailed: 1, testCommandPassed: false });
    expect(screen.getByText("Failed", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/3 passed.*1 failed/)).toBeInTheDocument();
  });
});
