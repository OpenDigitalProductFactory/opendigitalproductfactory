// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BuildDesignDoc } from "@/lib/feature-build-types";

const contextMock = vi.fn();
const amendMock = vi.fn();

vi.mock("@/lib/actions/decomposition-actions", () => ({
  getParentDesignAmendmentContextAction: (...args: unknown[]) => contextMock(...args),
  amendParentDesignAction: (...args: unknown[]) => amendMock(...args),
}));

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  contextMock.mockReset();
  amendMock.mockReset();
});

import { ParentDesignAmendmentCoordinator } from "./ParentDesignAmendmentCoordinator";

const parentDesignDoc: BuildDesignDoc = {
  problemStatement: "Dale needs the right truck parts without return trips.",
  reusePlan: "Reuse Build Studio child builds.",
  proposedApproach: "Build read, usage, and restock flows.",
  acceptanceCriteria: ["Find truck parts", "Record a used part", "Review low stock"],
};

function contextResult() {
  return {
    ok: true,
    parentEpic: {
      epicId: "EP-TRUCK",
      title: "Truck inventory",
      designDoc: parentDesignDoc,
    },
    currentChildBuildId: "FB-CHILD2",
    children: [
      { buildId: "FB-CHILD1", title: "Read parts", phase: "complete", childOrder: 1 },
      { buildId: "FB-CHILD2", title: "Use parts", phase: "plan", childOrder: 2 },
      { buildId: "FB-CHILD3", title: "Restock", phase: "plan", childOrder: 3 },
    ],
  };
}

describe("ParentDesignAmendmentCoordinator", () => {
  it("opens from the parent-amendment event and submits a proposed parent design", async () => {
    contextMock.mockResolvedValue(contextResult());
    amendMock.mockResolvedValue({
      ok: true,
      quiescenceRunId: "QR-2026-05-24-amend",
      updatedChildBuildIds: ["FB-CHILD2", "FB-CHILD3"],
      skippedCompletedChildBuildIds: ["FB-CHILD1"],
    });

    render(<ParentDesignAmendmentCoordinator buildId="FB-CHILD2" />);
    expect(screen.queryByRole("dialog", { name: "Amend parent design" })).not.toBeInTheDocument();

    fireEvent(
      document,
      new CustomEvent("open-parent-design-amendment", {
        detail: { buildId: "FB-CHILD2" },
      }),
    );

    // The dialog shell mounts synchronously on open, but the parent summary and
    // form fields render only after the async context action resolves (a
    // transition update). Wait for context-dependent content with findBy* rather
    // than asserting synchronously after a bare "contextMock was called" wait —
    // that gap is the shard-timing race that made this suite flaky.
    expect(await screen.findByText("Truck inventory")).toBeInTheDocument();
    expect(contextMock).toHaveBeenCalledWith({ childBuildId: "FB-CHILD2" });
    expect(screen.getByRole("dialog", { name: "Amend parent design" })).toBeInTheDocument();
    expect(screen.getByText("Read parts")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Proposed approach"), {
      target: { value: "Keep lookup and usage now; defer supplier automation." },
    });
    fireEvent.change(screen.getByLabelText("Acceptance criteria"), {
      target: { value: "Find truck parts fast\nRecord a used part\nReview low stock" },
    });
    fireEvent.change(screen.getByLabelText("Amendment rationale"), {
      target: { value: "Dale needs lookup speed before supplier automation." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Apply parent amendment" }));

    await waitFor(() => {
      expect(amendMock).toHaveBeenCalledWith({
        childBuildId: "FB-CHILD2",
        proposedDesignDoc: {
          ...parentDesignDoc,
          proposedApproach: "Keep lookup and usage now; defer supplier automation.",
          acceptanceCriteria: [
            "Find truck parts fast",
            "Record a used part",
            "Review low stock",
          ],
        },
        rationale: "Dale needs lookup speed before supplier automation.",
      });
    });
    expect(screen.getByText(/Updated 2 child build/)).toBeInTheDocument();
  });

  it("surfaces server-side execution-child blocks without closing the panel", async () => {
    contextMock.mockResolvedValue({
      ...contextResult(),
      children: [
        { buildId: "FB-CHILD1", title: "Read parts", phase: "complete", childOrder: 1 },
        { buildId: "FB-CHILD2", title: "Use parts", phase: "review", childOrder: 2 },
        { buildId: "FB-CHILD3", title: "Restock", phase: "plan", childOrder: 3 },
      ],
    });
    amendMock.mockResolvedValue({
      ok: false,
      code: "execution-child-requires-operator-review",
      error: "One or more affected children has already entered build/review/ship.",
      blockedChildBuildIds: ["FB-CHILD2"],
    });

    render(<ParentDesignAmendmentCoordinator buildId="FB-CHILD2" />);
    fireEvent(
      document,
      new CustomEvent("open-parent-design-amendment", {
        detail: { buildId: "FB-CHILD2" },
      }),
    );
    // Wait for the context-loaded form field itself — not just the dialog shell,
    // which renders synchronously on open before the async context resolves.
    // getByLabelText immediately after findByRole("dialog") could run before the
    // input mounted; that was the intermittent failure at this line.
    fireEvent.change(await screen.findByLabelText("Amendment rationale"), {
      target: { value: "Adjust parent contract safely." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply parent amendment" }));

    await waitFor(() => {
      expect(screen.getByTestId("parent-amendment-error")).toHaveTextContent(
        "already entered build/review/ship",
      );
    });
    expect(screen.getByRole("dialog", { name: "Amend parent design" })).toBeInTheDocument();
  });
});
