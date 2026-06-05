// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { A2aInteractionsPanel } from "./A2aInteractionsPanel";
import type {
  OperationsMapA2aEdge,
  OperationsMapA2aLegendItem,
  OperationsMapRoutingCoworker,
} from "@/lib/ai-operations-map/types";

const COWORKERS: OperationsMapRoutingCoworker[] = [
  { agentId: "ceo-coworker", label: "CEO Coworker", stationLabel: "Direct" },
  { agentId: "brand-analyst", label: "Brand Analyst", stationLabel: "Brand" },
  { agentId: "reviewer", label: "Reviewer", stationLabel: "Review" },
];

const LEGEND: OperationsMapA2aLegendItem[] = [
  { edgeKind: "a2a-delegation", label: "Delegation", description: "Authority-bearing delegation." },
  { edgeKind: "a2a-handoff", label: "Phase handoff", description: "Build phase handoff." },
  { edgeKind: "a2a-task-lineage", label: "Task lineage", description: "Task lineage." },
  { edgeKind: "a2a-deliberation", label: "Deliberation", description: "Peer review fan-out." },
];

function edge(overrides: Partial<OperationsMapA2aEdge> = {}): OperationsMapA2aEdge {
  return {
    id: "edge-1",
    edgeKind: "a2a-delegation",
    fromCoworkerId: "ceo-coworker",
    toCoworkerId: "brand-analyst",
    state: "active",
    label: "Delegated brand-extract",
    summary: "Delegated brand extraction work.",
    occurredAt: "2026-06-04T10:00:00.000Z",
    authorityScope: ["brand:read"],
    skillId: "brand-extract",
    refs: { delegationChainId: "del-1" },
    weight: 2,
    ...overrides,
  };
}

function findButton(container: HTMLElement, name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!button) throw new Error(`button "${name}" not found`);
  return button as HTMLButtonElement;
}

afterEach(() => {
  cleanup();
  // The panel now persists filter state; isolate localStorage between tests.
  try {
    localStorage.clear();
  } catch {
    // jsdom always provides localStorage; ignore if unavailable.
  }
});

describe("A2aInteractionsPanel", () => {
  it("renders an empty state when there are no A2A interactions", () => {
    const { container } = render(
      <A2aInteractionsPanel coworkers={COWORKERS} a2aEdges={[]} a2aLegend={LEGEND} />,
    );
    expect(container.textContent).toContain("No coworker-to-coworker interactions recorded");
    expect(container.querySelectorAll("[data-a2a-edge]").length).toBe(0);
  });

  it("renders one edge per A2A interaction with its kind and state", () => {
    const { container } = render(
      <A2aInteractionsPanel
        coworkers={COWORKERS}
        a2aEdges={[
          edge(),
          edge({ id: "edge-2", edgeKind: "a2a-handoff", state: "completed", toCoworkerId: "reviewer" }),
          edge({ id: "edge-3", edgeKind: "a2a-task-lineage", state: "failed", fromCoworkerId: "brand-analyst", toCoworkerId: "reviewer" }),
        ]}
        a2aLegend={LEGEND}
      />,
    );
    const edges = container.querySelectorAll("[data-a2a-edge]");
    expect(edges.length).toBe(3);
    expect([...edges].map((el) => el.getAttribute("data-a2a-state")).sort()).toEqual([
      "active",
      "completed",
      "failed",
    ]);
  });

  it("narrows edges when a state filter is toggled off (troubleshooting view)", () => {
    const { container } = render(
      <A2aInteractionsPanel
        coworkers={COWORKERS}
        a2aEdges={[
          edge({ id: "a", state: "active" }),
          edge({ id: "b", state: "completed", toCoworkerId: "reviewer" }),
        ]}
        a2aLegend={LEGEND}
      />,
    );
    expect(container.querySelectorAll("[data-a2a-edge]").length).toBe(2);
    fireEvent.click(findButton(container, "Completed"));
    const remaining = container.querySelectorAll("[data-a2a-edge]");
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.getAttribute("data-a2a-state")).toBe("active");
  });

  it("narrows edges by interaction type", () => {
    const { container } = render(
      <A2aInteractionsPanel
        coworkers={COWORKERS}
        a2aEdges={[
          edge({ id: "a", edgeKind: "a2a-delegation" }),
          edge({ id: "b", edgeKind: "a2a-handoff", toCoworkerId: "reviewer" }),
        ]}
        a2aLegend={LEGEND}
      />,
    );
    fireEvent.click(findButton(container, "Phase handoff"));
    const remaining = container.querySelectorAll("[data-a2a-edge]");
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.getAttribute("data-a2a-edge")).toBe("a2a-delegation");
  });

  it("shows the from→to coworkers and authority in the inspector when an edge is selected", () => {
    const { container } = render(
      <A2aInteractionsPanel coworkers={COWORKERS} a2aEdges={[edge()]} a2aLegend={LEGEND} />,
    );
    const inspector = container.querySelector('[aria-label="Interaction inspector"]') as HTMLElement;
    expect(inspector.textContent).toContain("Select an interaction edge");

    fireEvent.click(container.querySelector("[data-a2a-edge]") as Element);

    expect(inspector.textContent).toContain("CEO Coworker");
    expect(inspector.textContent).toContain("Brand Analyst");
    expect(inspector.textContent).toContain("brand:read");
    expect(inspector.textContent).toContain("brand-extract");
  });

  it("scrubs in lock-step with the shared replay playhead", () => {
    const range = { start: 0, current: 60 * 60 * 1000, end: 100 * 60 * 1000 };
    const at = (min: number) => new Date(min * 60 * 1000).toISOString();
    const edges = [
      edge({ id: "early", occurredAt: at(40) }),
      edge({ id: "late", occurredAt: at(58), toCoworkerId: "reviewer" }),
    ];

    // Playhead at "current" → both visible, no synced banner.
    const atNow = render(
      <A2aInteractionsPanel coworkers={COWORKERS} a2aEdges={edges} a2aLegend={LEGEND} replayTime={range.current} replayRange={range} />,
    );
    expect(atNow.container.querySelectorAll("[data-a2a-edge]").length).toBe(2);
    expect(atNow.container.querySelector("[data-a2a-replay-synced]")).toBeNull();
    cleanup();

    // Scrubbed back to 50min → only the edge at 40min has occurred; the 58min
    // edge is in the future and hidden, and the synced banner appears.
    const scrubbed = render(
      <A2aInteractionsPanel coworkers={COWORKERS} a2aEdges={edges} a2aLegend={LEGEND} replayTime={50 * 60 * 1000} replayRange={range} />,
    );
    const visible = scrubbed.container.querySelectorAll("[data-a2a-edge]");
    expect(visible.length).toBe(1);
    expect(scrubbed.container.querySelector("[data-a2a-replay-synced]")).not.toBeNull();
  });
});
