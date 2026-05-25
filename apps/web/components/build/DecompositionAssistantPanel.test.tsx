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
