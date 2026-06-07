// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DeliberationLensPanel } from "./DeliberationLensPanel";
import type { OperationsMapDeliberation } from "@/lib/ai-operations-map/types";

function deliberation(overrides: Partial<OperationsMapDeliberation> = {}): OperationsMapDeliberation {
  return {
    id: "delib-1",
    coordinatorCoworkerId: "ceo-coworker",
    coordinatorLabel: "CEO Coworker",
    pattern: "Diversity review",
    diversityMode: "multi-provider-heterogeneous",
    consensusState: "partial-consensus",
    occurredAt: "2026-06-05T10:00:00.000Z",
    branches: [
      { nodeId: "n1", role: "reviewer", modelId: "claude-sonnet", providerId: "anthropic", status: "completed" },
      { nodeId: "n2", role: "skeptical_reviewer", modelId: "gpt-5", providerId: "openai", status: "completed" },
    ],
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("DeliberationLensPanel", () => {
  it("renders an empty state when there are no deliberations", () => {
    const { container } = render(<DeliberationLensPanel deliberations={[]} />);
    expect(container.textContent).toContain("No deliberations recorded");
    expect(container.querySelectorAll("[data-deliberation]").length).toBe(0);
  });

  it("renders one card per deliberation with coordinator, consensus, and branch roster", () => {
    const { container } = render(
      <DeliberationLensPanel deliberations={[deliberation(), deliberation({ id: "delib-2" })]} />,
    );
    expect(container.querySelectorAll("[data-deliberation]").length).toBe(2);
    // First card: coordinator + branches.
    expect(container.textContent).toContain("CEO Coworker");
    expect(container.querySelectorAll("[data-deliberation-branch]").length).toBe(4); // 2 branches x 2 cards
  });

  it("shows branch model/provider for diverse runs and consensus state", () => {
    const { container } = render(<DeliberationLensPanel deliberations={[deliberation()]} />);
    expect(container.textContent).toContain("anthropic / claude-sonnet");
    expect(container.textContent).toContain("openai / gpt-5");
    expect(container.textContent?.toLowerCase()).toContain("partial");
  });

  it("does not invent model/provider text for role-only branches", () => {
    const { container } = render(
      <DeliberationLensPanel
        deliberations={[
          deliberation({
            diversityMode: "single-model-multi-persona",
            branches: [{ nodeId: "n1", role: "reviewer", modelId: null, providerId: null, status: "running" }],
          }),
        ]}
      />,
    );
    const branch = container.querySelector("[data-deliberation-branch]") as HTMLElement;
    expect(branch.textContent).toContain("Reviewer");
    expect(branch.textContent).not.toContain("/"); // no provider/model separator fabricated
  });
});
