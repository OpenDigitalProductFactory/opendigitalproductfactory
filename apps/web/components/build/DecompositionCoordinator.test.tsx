// @vitest-environment jsdom
//
// Coverage for the Phase 4c page-level coordinator.
// Spec: docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md
// BI: BI-2E6CC391.

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DecompositionCandidate } from "@/lib/build/decomposition-candidates";
import type { SizeAssessmentSnapshot } from "@/lib/explore/feature-build-types";

afterEach(() => {
  cleanup();
});

// --- Mocks for the three server actions ----------------------------------

const proposeMock = vi.fn();
const approveMock = vi.fn();
const overrideMock = vi.fn();

vi.mock("@/lib/actions/decomposition-actions", () => ({
  proposeBuildDecompositionAction: (...args: unknown[]) => proposeMock(...args),
  approveDecompositionAction: (...args: unknown[]) => approveMock(...args),
  recordDecompositionOverrideAction: (...args: unknown[]) => overrideMock(...args),
}));

beforeEach(() => {
  proposeMock.mockReset();
  approveMock.mockReset();
  overrideMock.mockReset();
});

// Import after the mock is registered.
import { DecompositionCoordinator } from "./DecompositionCoordinator";

// --- Fixtures ------------------------------------------------------------

function makeAssessment(
  decision: SizeAssessmentSnapshot["decision"] = "decompose-required",
): SizeAssessmentSnapshot {
  return {
    decision,
    breakdown: {
      models: { count: 5, samples: [] },
      endpoints: { count: 2, samples: [] },
      acs: { count: 5 },
      multipliers: { count: 4, matchedKeywords: [] },
      routes: { count: 2, samples: [] },
    },
    trips: [],
    rationale: "test",
    thresholds: {
      models: { recommend: 3, required: 5 },
      endpoints: { recommend: 4, required: 7 },
      acs: { recommend: 12, required: 20 },
      multipliers: { recommend: 2, required: 4 },
      routes: { recommend: 2, required: 4 },
    },
    assessedAt: "2026-05-24T20:00:00.000Z",
  };
}

function makeCandidate(id = "candidate-1"): DecompositionCandidate {
  return {
    candidateId: id,
    rationale: `Rationale for ${id}`,
    childScopes: [
      { childOrder: 1, title: "Read", summary: "x", acceptanceCriteriaIndices: [0, 1], dependsOn: [] },
      { childOrder: 2, title: "Write", summary: "y", acceptanceCriteriaIndices: [2, 3, 4], dependsOn: [1] },
    ],
  };
}

const acs = ["AC0", "AC1", "AC2", "AC3", "AC4"];

// --- Self-gate -----------------------------------------------------------

describe("DecompositionCoordinator — self-gate", () => {
  it("renders nothing when assessment is null", () => {
    const { container } = render(
      <DecompositionCoordinator
        buildId="FB-DALE"
        parentAcceptanceCriteria={acs}
        assessment={null}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when decision is ok", () => {
    const { container } = render(
      <DecompositionCoordinator
        buildId="FB-DALE"
        parentAcceptanceCriteria={acs}
        assessment={makeAssessment("ok")}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

// --- Propose flow --------------------------------------------------------

describe("DecompositionCoordinator — propose flow", () => {
  it("calls propose action when banner CTA fires and no candidates exist yet", async () => {
    proposeMock.mockResolvedValue({
      ok: true,
      candidates: [makeCandidate()],
      rejected: [],
    });
    render(
      <DecompositionCoordinator
        buildId="FB-DALE"
        parentAcceptanceCriteria={acs}
        assessment={makeAssessment("decompose-required")}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /propose splits/i }));
    await waitFor(() => {
      expect(proposeMock).toHaveBeenCalledWith({ buildId: "FB-DALE" });
    });
    // Panel opens once candidates are loaded.
    await waitFor(() => {
      expect(screen.getByTestId("decomposition-assistant-panel")).toBeInTheDocument();
    });
  });

  it("opens panel directly without re-proposing when initialCandidates exist", () => {
    render(
      <DecompositionCoordinator
        buildId="FB-DALE"
        parentAcceptanceCriteria={acs}
        assessment={makeAssessment("decompose-required")}
        initialCandidates={[makeCandidate()]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /propose splits/i }));
    expect(proposeMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("decomposition-assistant-panel")).toBeInTheDocument();
  });

  it("opens from the D38 decompose event without rendering the size banner", async () => {
    proposeMock.mockResolvedValue({
      ok: true,
      candidates: [makeCandidate()],
      rejected: [],
    });
    render(
      <DecompositionCoordinator
        buildId="FB-DALE"
        parentAcceptanceCriteria={acs}
        assessment={makeAssessment("ok")}
        planOscillationEntry
      />,
    );

    expect(screen.queryByTestId("decomposition-gate-banner")).not.toBeInTheDocument();

    fireEvent(
      document,
      new CustomEvent("open-build-decomposition", {
        detail: { buildId: "FB-DALE" },
      }),
    );

    await waitFor(() => {
      expect(proposeMock).toHaveBeenCalledWith({ buildId: "FB-DALE" });
    });
    expect(screen.getByTestId("decomposition-assistant-panel")).toBeInTheDocument();
  });

  it("surfaces propose-action error in the inline error line", async () => {
    proposeMock.mockResolvedValue({
      ok: false,
      code: "build-no-size-assessment",
      error: "No size assessment recorded.",
    });
    render(
      <DecompositionCoordinator
        buildId="FB-DALE"
        parentAcceptanceCriteria={acs}
        assessment={makeAssessment("decompose-required")}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /propose splits/i }));
    await waitFor(() => {
      const errorEl = screen.getByTestId("decomposition-coordinator-error");
      expect(errorEl.textContent).toMatch(/No size assessment recorded/);
    });
    // Panel should NOT open on failure.
    expect(screen.queryByTestId("decomposition-assistant-panel")).not.toBeInTheDocument();
  });

  it("regenerate from the panel calls propose action with the typed hint", async () => {
    proposeMock.mockResolvedValue({
      ok: true,
      candidates: [makeCandidate()],
      rejected: [],
    });
    render(
      <DecompositionCoordinator
        buildId="FB-DALE"
        parentAcceptanceCriteria={acs}
        assessment={makeAssessment("decompose-required")}
        initialCandidates={[makeCandidate()]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /propose splits/i }));
    // panel open; click regenerate path
    fireEvent.click(screen.getByRole("button", { name: /reject all/i }));
    fireEvent.change(screen.getByPlaceholderText(/optional hint/i), {
      target: { value: "ship the ledger separately" },
    });
    fireEvent.click(screen.getByRole("button", { name: /regenerate with hint/i }));
    await waitFor(() => {
      expect(proposeMock).toHaveBeenCalledWith({
        buildId: "FB-DALE",
        operatorHint: "ship the ledger separately",
      });
    });
  });
});

// --- Approve flow --------------------------------------------------------

describe("DecompositionCoordinator — approve flow", () => {
  it("dispatches approve action with the selected candidate", async () => {
    approveMock.mockResolvedValue({
      ok: true,
      epicId: "EP-TEST",
      childBuildIds: ["FB-C1", "FB-C2"],
    });
    const c = makeCandidate();
    render(
      <DecompositionCoordinator
        buildId="FB-DALE"
        parentAcceptanceCriteria={acs}
        assessment={makeAssessment("decompose-required")}
        initialCandidates={[c]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /propose splits/i }));
    fireEvent.click(screen.getByRole("button", { name: /approve selected/i }));
    await waitFor(() => {
      expect(approveMock).toHaveBeenCalledWith({
        buildId: "FB-DALE",
        candidate: c,
      });
    });
  });

  it("closes the panel after successful approval", async () => {
    approveMock.mockResolvedValue({
      ok: true,
      epicId: "EP-TEST",
      childBuildIds: [],
    });
    render(
      <DecompositionCoordinator
        buildId="FB-DALE"
        parentAcceptanceCriteria={acs}
        assessment={makeAssessment("decompose-required")}
        initialCandidates={[makeCandidate()]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /propose splits/i }));
    expect(screen.getByTestId("decomposition-assistant-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /approve selected/i }));
    await waitFor(() => {
      expect(screen.queryByTestId("decomposition-assistant-panel")).not.toBeInTheDocument();
    });
  });

  it("surfaces approve-action error and keeps the panel open for retry", async () => {
    approveMock.mockResolvedValue({
      ok: false,
      code: "candidate-validation-failed",
      error: "AC index out of range.",
    });
    render(
      <DecompositionCoordinator
        buildId="FB-DALE"
        parentAcceptanceCriteria={acs}
        assessment={makeAssessment("decompose-required")}
        initialCandidates={[makeCandidate()]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /propose splits/i }));
    fireEvent.click(screen.getByRole("button", { name: /approve selected/i }));
    await waitFor(() => {
      const errorEl = screen.getByTestId("decomposition-coordinator-error");
      expect(errorEl.textContent).toMatch(/AC index out of range/);
    });
    expect(screen.getByTestId("decomposition-assistant-panel")).toBeInTheDocument();
  });
});

// --- Override flow -------------------------------------------------------

describe("DecompositionCoordinator — override flow", () => {
  it("dispatches override action with the operator rationale", async () => {
    overrideMock.mockResolvedValue({
      ok: true,
      override: {
        rationale: "Solo dev",
        recordedAt: "now",
        recordedByUserId: "u1",
        recordedByAgentId: null,
      },
    });
    render(
      <DecompositionCoordinator
        buildId="FB-DALE"
        parentAcceptanceCriteria={acs}
        assessment={makeAssessment("decompose-required")}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /keep as one build/i }));
    fireEvent.change(screen.getByLabelText(/override rationale/i), {
      target: { value: "Solo dev ships this end-to-end." },
    });
    fireEvent.click(screen.getByRole("button", { name: /record override/i }));
    await waitFor(() => {
      expect(overrideMock).toHaveBeenCalledWith({
        buildId: "FB-DALE",
        rationale: "Solo dev ships this end-to-end.",
      });
    });
  });

  it("surfaces override-action error inline", async () => {
    overrideMock.mockResolvedValue({
      ok: false,
      code: "no-size-assessment",
      error: "No size assessment recorded.",
    });
    render(
      <DecompositionCoordinator
        buildId="FB-DALE"
        parentAcceptanceCriteria={acs}
        assessment={makeAssessment("decompose-required")}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /keep as one build/i }));
    fireEvent.change(screen.getByLabelText(/override rationale/i), {
      target: { value: "ok" },
    });
    fireEvent.click(screen.getByRole("button", { name: /record override/i }));
    await waitFor(() => {
      const errorEl = screen.getByTestId("decomposition-coordinator-error");
      expect(errorEl.textContent).toMatch(/No size assessment recorded/);
    });
  });
});

// --- Existing-override chip ---------------------------------------------

describe("DecompositionCoordinator — existing override", () => {
  it("renders the existing override chip when one is already recorded", () => {
    render(
      <DecompositionCoordinator
        buildId="FB-DALE"
        parentAcceptanceCriteria={acs}
        assessment={makeAssessment("decompose-required")}
        existingOverride={{
          rationale: "Solo dev override.",
          recordedAt: "2026-05-24T20:00:00.000Z",
          recordedByUserId: "u1",
          recordedByAgentId: null,
        }}
      />,
    );
    expect(screen.getByText(/Override recorded/i)).toBeInTheDocument();
    // Action buttons should NOT render when override exists.
    expect(screen.queryByRole("button", { name: /propose splits/i })).not.toBeInTheDocument();
  });
});
