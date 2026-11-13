// @vitest-environment jsdom
import "@/test-setup";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeatureBuildRow } from "@/lib/feature-build-types";
import { SavedBuildReader } from "./SavedBuildReader";

const effects = vi.hoisted(() => ({ format: vi.fn(), decompose: vi.fn() }));
vi.mock("@/lib/actions/local-format", () => ({ formatText: effects.format }));
vi.mock("./DecompositionCoordinator", () => ({ DecompositionCoordinator: () => { effects.decompose(); return <button>Propose splits</button>; } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const saved = {
  id: "saved-row", buildId: "FB-SAVED", title: "Retained owner proof", phase: "review",
  verificationOut: { typecheckPassed: true, testsPassed: 4, testsFailed: 0, testsExecuted: true, testsApplicable: true, testCommandPassed: true, testSummariesComplete: true, fullOutput: "Retained raw report" },
  designDoc: { problemStatement: "Stored problem", proposedApproach: "Stored approach ".repeat(20), acceptanceCriteria: [] },
  designReview: { decision: "pass", summary: "Stored review", issues: [] },
  taskResults: null, brief: null, buildPlan: null, planReview: null, acceptanceMet: null, uxTestResults: null,
} as unknown as FeatureBuildRow;

describe("saved proof without execution", () => {
  it("opens real retained proof without mounting inference or decomposition controls", () => {
    render(<SavedBuildReader builds={[saved]} initialBuildId="FB-SAVED" />);
    fireEvent.click(screen.getByRole("button", { name: "Review proof" }));
    expect(screen.getByText("Passed", { exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Design Document/ }));
    expect(screen.getByText("Stored problem")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Format for readability|Propose splits/ })).not.toBeInTheDocument();
    expect(effects.format).not.toHaveBeenCalled();
    expect(effects.decompose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Verification/ }));
    fireEvent.click(screen.getByRole("button", { name: "Show raw output" }));
    expect(screen.getByText("Retained raw report")).toBeInTheDocument();
  });
  it("does not substitute a different saved record for an unavailable requested build", () => {
    render(<SavedBuildReader builds={[saved]} initialBuildId="FB-UNAVAILABLE" />);
    expect(screen.getByText("The requested saved build is unavailable.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review proof" })).not.toBeInTheDocument();
  });
  it("replaces retained proof without borrowing the earlier successful result", () => {
    const { rerender } = render(<SavedBuildReader builds={[saved]} initialBuildId="FB-SAVED" />);
    fireEvent.click(screen.getByRole("button", { name: "Review proof" }));
    expect(screen.getByText("Passed", { exact: true })).toBeInTheDocument();
    const replacement = { ...saved, verificationOut: { typecheckPassed: null, testsPassed: 0, testsFailed: 0, testsExecuted: false, testsApplicable: null } } as FeatureBuildRow;
    rerender(<SavedBuildReader builds={[replacement]} initialBuildId="FB-SAVED" />);
    expect(screen.getByText("Unverified", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("Passed", { exact: true })).not.toBeInTheDocument();
  });
  it("keeps empty history distinct from unavailable execution", () => {
    render(<SavedBuildReader builds={[]} />);
    expect(screen.getByText("No saved builds yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review proof" })).not.toBeInTheDocument();
  });
});
