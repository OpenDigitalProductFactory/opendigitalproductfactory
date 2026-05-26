// @vitest-environment jsdom
//
// Coverage for the Phase 4b decomposition assistant slide-over.
// Spec: docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md (§4.2)
// BI: BI-2E6CC391.

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DecompositionAssistantPanel } from "./DecompositionAssistantPanel";
import type { DecompositionCandidate } from "@/lib/build/decomposition-candidates";

afterEach(() => {
  cleanup();
});

function makeCandidate(id = "candidate-1"): DecompositionCandidate {
  return {
    candidateId: id,
    rationale: `Rationale for ${id}`,
    childScopes: [
      { childOrder: 1, title: "Truck inventory read", summary: "Show parts.", acceptanceCriteriaIndices: [0, 1], dependsOn: [] },
      { childOrder: 2, title: "Record usage", summary: "Mark used.", acceptanceCriteriaIndices: [2, 3], dependsOn: [1] },
      { childOrder: 3, title: "Low-stock surfacing", summary: "Restock view.", acceptanceCriteriaIndices: [4], dependsOn: [1, 2] },
    ],
  };
}

const acs = [
  "AC0: Tech sees inventory.",
  "AC1: Quantity + low-stock.",
  "AC2: Mark usage.",
  "AC3: Idempotency.",
  "AC4: Dispatch rollup.",
];

describe("DecompositionAssistantPanel — open/close behaviour", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(
      <DecompositionAssistantPanel
        open={false}
        parentAcceptanceCriteria={acs}
        candidates={[makeCandidate()]}
        onApprove={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("calls onClose when the overlay is clicked", () => {
    const onClose = vi.fn();
    render(
      <DecompositionAssistantPanel
        open={true}
        parentAcceptanceCriteria={acs}
        candidates={[makeCandidate()]}
        onApprove={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByLabelText(/close decomposition assistant/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the Cancel button is clicked", () => {
    const onClose = vi.fn();
    render(
      <DecompositionAssistantPanel
        open={true}
        parentAcceptanceCriteria={acs}
        candidates={[makeCandidate()]}
        onApprove={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("DecompositionAssistantPanel — candidate rendering", () => {
  it("renders all candidates with their child scopes", () => {
    render(
      <DecompositionAssistantPanel
        open={true}
        parentAcceptanceCriteria={acs}
        candidates={[makeCandidate("a"), makeCandidate("b")]}
        onApprove={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("candidate-card-a")).toBeInTheDocument();
    expect(screen.getByTestId("candidate-card-b")).toBeInTheDocument();
  });

  it("renders each child scope's title + summary", () => {
    render(
      <DecompositionAssistantPanel
        open={true}
        parentAcceptanceCriteria={acs}
        candidates={[makeCandidate()]}
        onApprove={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Truck inventory read")).toBeInTheDocument();
    expect(screen.getByText("Record usage")).toBeInTheDocument();
    expect(screen.getByText("Low-stock surfacing")).toBeInTheDocument();
  });

  it("renders parent AC text for each AC index in each child", () => {
    render(
      <DecompositionAssistantPanel
        open={true}
        parentAcceptanceCriteria={acs}
        candidates={[makeCandidate()]}
        onApprove={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const child1 = screen.getByTestId("child-scope-1");
    expect(child1.textContent).toMatch(/Tech sees inventory/);
    expect(child1.textContent).toMatch(/low-stock/i);

    const child3 = screen.getByTestId("child-scope-3");
    expect(child3.textContent).toMatch(/Dispatch rollup/);
  });

  it("renders 'depends on' chip when a child has sibling dependencies", () => {
    render(
      <DecompositionAssistantPanel
        open={true}
        parentAcceptanceCriteria={acs}
        candidates={[makeCandidate()]}
        onApprove={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const child3 = screen.getByTestId("child-scope-3");
    expect(child3.textContent).toMatch(/depends on #1, #2/);
  });

  it("renders empty state when candidates array is empty", () => {
    render(
      <DecompositionAssistantPanel
        open={true}
        parentAcceptanceCriteria={acs}
        candidates={[]}
        onApprove={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/No candidates available yet/i)).toBeInTheDocument();
  });
});

describe("DecompositionAssistantPanel — approve flow", () => {
  it("approves the first candidate by default", () => {
    const onApprove = vi.fn();
    const c1 = makeCandidate("a");
    const c2 = makeCandidate("b");
    render(
      <DecompositionAssistantPanel
        open={true}
        parentAcceptanceCriteria={acs}
        candidates={[c1, c2]}
        onApprove={onApprove}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /approve selected/i }));
    expect(onApprove).toHaveBeenCalledWith(c1);
  });

  it("switches selection when a different radio is chosen", () => {
    const onApprove = vi.fn();
    const c1 = makeCandidate("a");
    const c2 = makeCandidate("b");
    render(
      <DecompositionAssistantPanel
        open={true}
        parentAcceptanceCriteria={acs}
        candidates={[c1, c2]}
        onApprove={onApprove}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(within(screen.getByTestId("candidate-card-b")).getByRole("radio"));
    fireEvent.click(screen.getByRole("button", { name: /approve selected/i }));
    expect(onApprove).toHaveBeenCalledWith(c2);
  });

  it("disables Approve when approving=true and shows 'Approving…'", () => {
    render(
      <DecompositionAssistantPanel
        open={true}
        parentAcceptanceCriteria={acs}
        candidates={[makeCandidate()]}
        approving={true}
        onApprove={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: /approving/i });
    expect(btn).toBeDisabled();
  });

  it("disables Approve when candidates is empty (nothing selectable)", () => {
    render(
      <DecompositionAssistantPanel
        open={true}
        parentAcceptanceCriteria={acs}
        candidates={[]}
        onApprove={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: /approve selected/i });
    expect(btn).toBeDisabled();
  });
});

describe("DecompositionAssistantPanel — regenerate flow", () => {
  it("opens the hint input on first 'Reject all + regenerate' click without firing onRegenerate", () => {
    const onRegenerate = vi.fn();
    render(
      <DecompositionAssistantPanel
        open={true}
        parentAcceptanceCriteria={acs}
        candidates={[makeCandidate()]}
        onApprove={vi.fn()}
        onRegenerate={onRegenerate}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /reject all/i }));
    expect(onRegenerate).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText(/optional hint/i)).toBeInTheDocument();
  });

  it("fires onRegenerate with the typed hint on second click", () => {
    const onRegenerate = vi.fn();
    render(
      <DecompositionAssistantPanel
        open={true}
        parentAcceptanceCriteria={acs}
        candidates={[makeCandidate()]}
        onApprove={vi.fn()}
        onRegenerate={onRegenerate}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /reject all/i }));
    fireEvent.change(screen.getByPlaceholderText(/optional hint/i), {
      target: { value: "make the read-first smaller" },
    });
    fireEvent.click(screen.getByRole("button", { name: /regenerate with hint/i }));
    expect(onRegenerate).toHaveBeenCalledWith("make the read-first smaller");
  });

  it("fires onRegenerate with an empty string when no hint is typed", () => {
    const onRegenerate = vi.fn();
    render(
      <DecompositionAssistantPanel
        open={true}
        parentAcceptanceCriteria={acs}
        candidates={[makeCandidate()]}
        onApprove={vi.fn()}
        onRegenerate={onRegenerate}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /reject all/i }));
    fireEvent.click(screen.getByRole("button", { name: /regenerate with hint/i }));
    expect(onRegenerate).toHaveBeenCalledWith("");
  });

  it("disables Regenerate while regenerating=true", () => {
    render(
      <DecompositionAssistantPanel
        open={true}
        parentAcceptanceCriteria={acs}
        candidates={[makeCandidate()]}
        regenerating={true}
        onApprove={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: /regenerating/i });
    expect(btn).toBeDisabled();
  });
});

describe("DecompositionAssistantPanel — header copy", () => {
  it("renders the parent build title in the header when provided", () => {
    render(
      <DecompositionAssistantPanel
        open={true}
        parentAcceptanceCriteria={acs}
        candidates={[makeCandidate()]}
        parentBuildTitle="Truck inventory"
        decisionLabel="decompose-required"
        onApprove={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const header = screen.getByText("Truck inventory");
    expect(header).toBeInTheDocument();
    expect(header.parentElement?.textContent).toMatch(/decomposition required/);
  });
});

describe("DecompositionAssistantPanel — edit mode (Phase 4c)", () => {
  it("moves an AC from one child to another via the move menu", () => {
    const onApprove = vi.fn();
    render(
      <DecompositionAssistantPanel
        open={true}
        parentAcceptanceCriteria={acs}
        candidates={[makeCandidate()]}
        onApprove={onApprove}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // Open the move menu for AC index 0 (in child #1) and move to child #2.
    fireEvent.click(screen.getByTestId("move-ac-0-from-1"));
    fireEvent.click(screen.getByTestId("move-ac-0-to-2"));

    // Approve and inspect the candidate that was passed.
    fireEvent.click(screen.getByRole("button", { name: /approve selected/i }));
    expect(onApprove).toHaveBeenCalledTimes(1);
    const passedCandidate = onApprove.mock.calls[0]![0];
    const child1 = passedCandidate.childScopes.find((s: { childOrder: number }) => s.childOrder === 1);
    const child2 = passedCandidate.childScopes.find((s: { childOrder: number }) => s.childOrder === 2);
    expect(child1.acceptanceCriteriaIndices).not.toContain(0);
    expect(child2.acceptanceCriteriaIndices).toContain(0);
  });

  it("marks the edited candidate with an EDITED badge", () => {
    render(
      <DecompositionAssistantPanel
        open={true}
        parentAcceptanceCriteria={acs}
        candidates={[makeCandidate()]}
        onApprove={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("edited-badge")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("move-ac-4-from-3"));
    fireEvent.click(screen.getByTestId("move-ac-4-to-2"));
    expect(screen.getByTestId("edited-badge")).toBeInTheDocument();
  });

  it("renames a child title via inline edit (Enter saves)", () => {
    const onApprove = vi.fn();
    render(
      <DecompositionAssistantPanel
        open={true}
        parentAcceptanceCriteria={acs}
        candidates={[makeCandidate()]}
        onApprove={onApprove}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("child-title-1"));
    const input = screen.getByTestId("child-title-input-1");
    fireEvent.change(input, { target: { value: "Look up parts on a truck" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: /approve selected/i }));
    const passed = onApprove.mock.calls[0]![0];
    const child1 = passed.childScopes.find((s: { childOrder: number }) => s.childOrder === 1);
    expect(child1.title).toBe("Look up parts on a truck");
  });

  it("rename cancels on Escape and restores original title", () => {
    const onApprove = vi.fn();
    render(
      <DecompositionAssistantPanel
        open={true}
        parentAcceptanceCriteria={acs}
        candidates={[makeCandidate()]}
        onApprove={onApprove}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("child-title-1"));
    const input = screen.getByTestId("child-title-input-1");
    fireEvent.change(input, { target: { value: "discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /approve selected/i }));
    const passed = onApprove.mock.calls[0]![0];
    const child1 = passed.childScopes.find((s: { childOrder: number }) => s.childOrder === 1);
    expect(child1.title).toBe("Truck inventory read"); // unchanged
  });

  it("disables Approve and shows validation failure when edits break the partition", () => {
    // Move ALL of child #2's ACs into child #1, leaving #2 with zero ACs.
    // empty-child-scope failure should surface.
    render(
      <DecompositionAssistantPanel
        open={true}
        parentAcceptanceCriteria={acs}
        candidates={[makeCandidate()]}
        onApprove={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // Child #2 originally has ACs [2, 3]. Move both to #1.
    fireEvent.click(screen.getByTestId("move-ac-2-from-2"));
    fireEvent.click(screen.getByTestId("move-ac-2-to-1"));
    fireEvent.click(screen.getByTestId("move-ac-3-from-2"));
    fireEvent.click(screen.getByTestId("move-ac-3-to-1"));

    expect(screen.getByTestId("validation-failure-list")).toBeInTheDocument();
    expect(screen.getByText(/empty-child-scope/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /approve selected/i })).toBeDisabled();
  });

  it("'Reset edits' clears the working copy back to the original", () => {
    const onApprove = vi.fn();
    render(
      <DecompositionAssistantPanel
        open={true}
        parentAcceptanceCriteria={acs}
        candidates={[makeCandidate()]}
        onApprove={onApprove}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("move-ac-0-from-1"));
    fireEvent.click(screen.getByTestId("move-ac-0-to-2"));
    expect(screen.getByTestId("edited-badge")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /reset edits/i }));
    expect(screen.queryByTestId("edited-badge")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /approve selected/i }));
    const passed = onApprove.mock.calls[0]![0];
    const child1 = passed.childScopes.find((s: { childOrder: number }) => s.childOrder === 1);
    expect(child1.acceptanceCriteriaIndices).toContain(0);
  });

  it("only the SELECTED candidate is editable; unselected cards have no move buttons", () => {
    render(
      <DecompositionAssistantPanel
        open={true}
        parentAcceptanceCriteria={acs}
        candidates={[makeCandidate("a"), makeCandidate("b")]}
        onApprove={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // Candidate "a" is selected by default; the move-ac-0 button should exist
    // for its scopes. Candidate "b" is unselected; its scopes should not have
    // a move button.
    const cardA = screen.getByTestId("candidate-card-a");
    const cardB = screen.getByTestId("candidate-card-b");
    expect(within(cardA).queryByTestId("move-ac-0-from-1")).toBeInTheDocument();
    expect(within(cardB).queryByTestId("move-ac-0-from-1")).not.toBeInTheDocument();
  });
});
