// @vitest-environment jsdom
import "@/test-setup";
import { cleanup, fireEvent, render as renderUI, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeatureBuildRow } from "@/lib/feature-build-types";
import { SavedBuildReader } from "./ReviewPanel";
import type { ReactElement } from "react";
import { namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
const render = (ui: ReactElement) => renderUI(ui, { wrapper: ({ children }) => <MessagesProvider locale="en-US" messages={{ workrooms: namespaceMessages("en-US", "workrooms") }}>{children}</MessagesProvider> });

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
  it("uses the supplied viewer catalog rather than hardcoded arrival copy", () => {
    render(<MessagesProvider locale="en-XA" messages={{ workrooms: namespaceMessages("en-XA", "workrooms") }}><SavedBuildReader builds={[]} /></MessagesProvider>);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toMatch(/^⟦/);
    expect(screen.queryByRole("heading", { name: "Saved builds" })).not.toBeInTheDocument();
  });
  it("opens real retained proof without mounting inference or decomposition controls", () => {
    render(<SavedBuildReader builds={[saved]} initialBuildId="FB-SAVED" />);
    fireEvent.click(screen.getByText("Review proof", { selector: "summary" }));
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
    expect(screen.getByText("Saved build unavailable.")).toBeInTheDocument();
    expect(screen.queryByText("Review proof", { selector: "summary" })).not.toBeInTheDocument();
  });
  it("replaces retained proof without borrowing the earlier successful result", () => {
    const { rerender } = render(<SavedBuildReader builds={[saved]} initialBuildId="FB-SAVED" />);
    fireEvent.click(screen.getByText("Review proof", { selector: "summary" }));
    expect(screen.getByText("Passed", { exact: true })).toBeInTheDocument();
    const replacement = { ...saved, verificationOut: { typecheckPassed: null, testsPassed: 0, testsFailed: 0, testsExecuted: false, testsApplicable: null } } as FeatureBuildRow;
    rerender(<SavedBuildReader builds={[replacement]} initialBuildId="FB-SAVED" />);
    expect(screen.getByText("Unverified", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("Passed", { exact: true })).not.toBeInTheDocument();
  });
  it("keeps empty history distinct from unavailable execution", () => {
    render(<SavedBuildReader builds={[]} />);
    expect(screen.getByText("No saved builds.")).toBeInTheDocument();
    expect(screen.queryByText("Review proof", { selector: "summary" })).not.toBeInTheDocument();
  });
  it("keeps directly opened proof readable when its build is outside the fleet list", () => {
    render(<SavedBuildReader builds={[]} initialBuildId={saved.buildId} initialActiveBuild={saved} />);
    expect(screen.queryByText("No saved builds.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Review proof", { selector: "summary" }));
    expect(screen.getByText("Passed", { exact: true })).toBeInTheDocument();
  });
  it("exposes selected proof before a long fleet and gives its disclosure an accessible target", () => {
    const fleet = Array.from({ length: 76 }, (_, index) => ({ ...saved, id: `row-${index}`, buildId: `FB-${index}` }));
    render(<SavedBuildReader builds={fleet} initialActiveBuild={saved} />);
    const trigger = screen.getByText("Review proof", { selector: "summary" });
    expect(trigger.compareDocumentPosition(screen.getByRole("table", { hidden: true })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(trigger.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(trigger);
    const proof = screen.getByRole("region", { name: saved.title });
    expect(proof).toBeVisible();
    expect(trigger.closest("details")).toHaveAttribute("open");
    expect(screen.getByText("Passed", { exact: true })).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(trigger.closest("details")).not.toHaveAttribute("open");
    expect(proof).not.toBeVisible();
  });
  it("keeps fleet history behind a native disclosure on arrival", () => {
    render(<SavedBuildReader builds={[saved]} />);
    expect(screen.getByRole("table", { hidden: true })).not.toBeVisible();
    expect(screen.getByText("Saved builds", { selector: "summary" }).closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("Review proof", { selector: "summary" })).toBeInTheDocument();
  });
});
