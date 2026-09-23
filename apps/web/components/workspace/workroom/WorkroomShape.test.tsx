// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WorkroomShape } from "./WorkroomShape";
import type { ShapeGraph } from "@/lib/work-management/shape-projection";

const replace = vi.fn();
const refresh = vi.fn();
const navigation = vi.hoisted(() => ({ query: "operation=reviewer-recovery" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigation.query),
  usePathname: () => "/workspace/cases/reviewer",
  useRouter: () => ({ replace, refresh }),
}));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); navigation.query = "operation=reviewer-recovery"; });

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
  it("ages the displayed snapshot and clears stale only after a newer server read", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
    const current = structuredClone(graph);
    current.process!.readAt = "2026-09-21T12:00:00Z";
    const { rerender } = render(<WorkroomShape graph={current} />);
    expect(screen.queryByText(/Snapshot stale/)).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText(/Snapshot stale/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh state" }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText(/Snapshot stale/)).toBeInTheDocument();
    const newer = structuredClone(current);
    newer.process!.readAt = "2026-09-21T12:01:00Z";
    rerender(<WorkroomShape graph={newer} />);
    expect(screen.queryByText(/Snapshot stale/)).not.toBeInTheDocument();
  });

  it("returns to the same coordination filters and page without leaking step filters", () => {
    navigation.query = "operation=all&coordinationQuery=review&coordinationStatus=blocked&coordinationAfter=WC-099&initiativeQuery=Reliable&processStep=review&processQuery=prepare";
    render(<WorkroomShape graph={graph} />);
    expect(screen.getByRole("link", { name: "Operation" })).toHaveAttribute("href",
      "/ea/workrooms?operation=all&coordinationQuery=review&coordinationStatus=blocked&coordinationAfter=WC-099&initiativeQuery=Reliable#coordination");
  });
  it("previews linked records without implying established impact and reveals every identity", () => {
    const many = structuredClone(graph);
    many.stages[0].inspection!.affected = Array.from({ length: 21 }, (_, index) => ({ kind: "task-run" as const, id: `review-${index}` }));
    render(<WorkroomShape graph={many} />);
    fireEvent.click(screen.getByRole("button", { name: /1\.\s*Prepare.*Not verified/ }));
    expect(screen.getByText("21 linked records; impact not established.")).toBeInTheDocument();
    expect(screen.queryByText("review-20")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show 18 more" }));
    expect(screen.getByText("review-20")).toBeInTheDocument();
  });

  it("keeps the filter disclosure open and focus intact when a filter is cleared", () => {
    render(<WorkroomShape graph={graph} />);
    const disclosure = screen.getByText("Search and filter steps").closest("details")!;
    disclosure.open = true;
    fireEvent(disclosure, new Event("toggle"));
    const search = screen.getByRole("searchbox", { name: "Search steps" });
    search.focus();
    fireEvent.change(search, { target: { value: "Prepare" } });
    fireEvent.change(search, { target: { value: "" } });
    expect(disclosure).toHaveAttribute("open");
    expect(search).toHaveFocus();
  });

  it("answers the six questions without implying verified progress", () => {
    render(<WorkroomShape graph={graph} />);
    expect(screen.getByRole("button", { name: /2\.\s*Review.*Not verified/ })).not.toHaveAttribute("aria-controls");
    fireEvent.click(screen.getByRole("button", { name: /2\.\s*Review.*Not verified/ }));
    for (const label of ["Where are we?", "Why are we here?", "What can happen next?", "Who owns the action?", "What evidence supports this?", "What else is affected?"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Approval is pending")).toBeInTheDocument();
    expect(screen.getByText("Provider evidence is unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/stages passed/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Operation" })).toHaveAttribute("href", "/ea/workrooms?operation=reviewer-recovery#coordination");
  });

  it("supports keyboard selection and preserves operation context in the URL", () => {
    render(<WorkroomShape graph={graph} />);
    const first = screen.getByRole("button", { name: /1\.\s*Prepare.*Not verified/ });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: /2\.\s*Review.*Not verified/ })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Review. Not verified. Approval is pending");
    expect(screen.getByRole("button", { name: /2\.\s*Review.*Not verified/ })).toHaveAttribute(
      "aria-controls", screen.getByRole("complementary", { name: "Review inspection" }).id,
    );
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("operation=reviewer-recovery"), { scroll: false });
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("processStep=review"), { scroll: false });
  });

  it("offers a list alternative with the same selected step", () => {
    render(<WorkroomShape graph={graph} />);
    fireEvent.click(screen.getByRole("button", { name: /2\.\s*Review.*Not verified/ }));
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.getByRole("button", { name: /2\.\s*Review.*Not verified/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("list", { name: "Process steps" })).toBeInTheDocument();
  });

  it("filters steps without losing selection or navigation context", () => {
    render(<WorkroomShape graph={graph} />);
    fireEvent.click(screen.getByText("Search and filter steps"));
    fireEvent.click(screen.getByRole("button", { name: /2\.\s*Review.*Not verified/ }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search steps" }), { target: { value: "Prepare" } });
    expect(screen.queryByRole("button", { name: /2\.\s*Review.*Not verified/ })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Review inspection" })).toBeInTheDocument();
    expect(replace).toHaveBeenLastCalledWith(expect.stringContaining("processStep=review"), { scroll: false });
    fireEvent.change(screen.getByRole("combobox", { name: "State" }), { target: { value: "holding" } });
    expect(screen.queryByRole("button", { name: /1\.\s*Prepare.*Not verified/ })).not.toBeInTheDocument();
    expect(screen.getByText("No matching steps")).toBeInTheDocument();
  });
});
