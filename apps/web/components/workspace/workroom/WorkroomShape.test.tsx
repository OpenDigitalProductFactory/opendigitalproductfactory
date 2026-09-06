// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WorkroomShape } from "./WorkroomShape";
import type { ShapeGraph } from "@/lib/work-management/shape-projection";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("operation=reviewer-recovery"),
  usePathname: () => "/workspace/cases/reviewer",
  useRouter: () => ({ replace }),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const graph: ShapeGraph = {
  stages: ["Prepare", "Review"].map((label) => ({ key: label.toLowerCase(), label, state: "unknown", parallel: false, rows: [], inspection: {
    position: `Intended ${label}`, reason: "Approval is pending", next: "An authorized reviewer can approve", owner: "Independent reviewer",
    expectedEvidence: ["review receipt"], affected: [{ kind: "task-run", id: "review-task" }],
  } })),
  blockingStageKey: null, progress: { passed: 0, total: 2 },
  process: { definitionRef: "reviewer@1.0.0", title: "Reviewer recovery", currentStageKey: null, nextPermittedStageKey: null,
    readAt: null, lastEvidenceAt: null, sourceHealth: "partial", gaps: ["Provider evidence is unavailable"], receipts: [] },
};

describe("Workroom process inspection", () => {
  it("answers the six questions without implying verified progress", () => {
    render(<WorkroomShape graph={graph} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    for (const label of ["Where are we?", "Why are we here?", "What can happen next?", "Who owns the action?", "What evidence supports this?", "What else is affected?"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Approval is pending")).toBeInTheDocument();
    expect(screen.getByText("Provider evidence is unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/stages passed/)).not.toBeInTheDocument();
  });

  it("supports keyboard selection and preserves operation context in the URL", () => {
    render(<WorkroomShape graph={graph} />);
    const first = screen.getByRole("button", { name: "Prepare" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: "Review" })).toHaveFocus();
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("operation=reviewer-recovery"), { scroll: false });
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("processStep=review"), { scroll: false });
  });

  it("offers a list alternative with the same selected step", () => {
    render(<WorkroomShape graph={graph} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.getByRole("button", { name: "Review" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("list", { name: "Process steps" })).toBeInTheDocument();
  });

  it("filters steps without losing selection or navigation context", () => {
    render(<WorkroomShape graph={graph} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search steps" }), { target: { value: "Prepare" } });
    expect(screen.queryByRole("button", { name: "Review" })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Review inspection" })).toBeInTheDocument();
    expect(replace).toHaveBeenLastCalledWith(expect.stringContaining("processStep=review"), { scroll: false });
    fireEvent.change(screen.getByRole("combobox", { name: "State" }), { target: { value: "holding" } });
    expect(screen.queryByRole("button", { name: "Prepare" })).not.toBeInTheDocument();
    expect(screen.getByText("No matching steps")).toBeInTheDocument();
  });
});
