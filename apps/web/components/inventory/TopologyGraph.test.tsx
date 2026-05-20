// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { getImpactData } from "@/lib/actions/graph";
import { TopologyGraph } from "./TopologyGraph";

// useTransition is mocked at module level so tests can flip `mockIsPending`
// before render. `vi.spyOn(React, "useTransition")` does not work under ESM —
// module namespaces are not configurable — so we follow vitest's recommended
// pattern: vi.mock with importOriginal, exposing a controllable stub.
let mockIsPending = false;
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useTransition: () =>
      [mockIsPending, (fn: () => void) => fn()] as readonly [
        boolean,
        (fn: () => void) => void,
      ],
  };
});

vi.mock("@/lib/actions/graph", () => ({
  getImpactData: vi.fn().mockResolvedValue({
    nodes: [
      { id: "ci-1", name: "Web Server", label: "InfraCI", color: "#ef4444", size: 10 },
      { id: "ci-2", name: "Database", label: "InfraCI", color: "#f97316", size: 5 },
    ],
    links: [{ source: "ci-1", target: "ci-2", type: "DEPENDS_ON" }],
  }),
  getDependencyAuditData: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
}));

vi.mock("@/lib/graph/use-graph-layout", () => ({
  useGraphLayout: vi.fn().mockReturnValue(null),
  shouldApplyLayoutResult: vi.fn().mockReturnValue(true),
}));

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // Must be a real constructor (arrow function fails `new ResizeObserver()`
  // in TopologyGraph.tsx:552). Previously masked by an unrelated spy failure
  // on the spinner test; surfaced once useTransition mocking was repaired.
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;

  global.requestAnimationFrame = vi.fn().mockReturnValue(0);
  global.cancelAnimationFrame = vi.fn();

  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    globalAlpha: 1,
    font: "",
    textAlign: "center",
    textBaseline: "alphabetic",
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

const emptyData = { nodes: [], links: [] };

describe("TopologyGraph", () => {
  it("calls getImpactData when impact-blast-radius view is active with a focusNodeId", async () => {
    render(
      <TopologyGraph
        data={emptyData}
        defaultView="impact-blast-radius"
        initialFocusNodeId="ci-1"
      />,
    );

    await waitFor(() => {
      expect(getImpactData).toHaveBeenCalledWith("ci-1");
    });
  });

  it("re-renders with stub data from getImpactData, showing the canvas", async () => {
    const { container } = render(
      <TopologyGraph
        data={emptyData}
        defaultView="impact-blast-radius"
        initialFocusNodeId="ci-1"
      />,
    );

    await waitFor(() => {
      expect(container.querySelector("canvas")).not.toBeNull();
    });
  });

  it("shows spinner overlay while isPending is true", () => {
    mockIsPending = true;

    const dataWithNodes = {
      nodes: [{ id: "n1", name: "Server", label: "InfraCI", color: "#ef4444", size: 6 }],
      links: [],
    };

    const { container } = render(
      <TopologyGraph data={dataWithNodes} defaultView="exploration" />,
    );

    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  // Module-level mocks (vi.mock) are not reset by restoreAllMocks, so reset
  // the controllable flag explicitly to keep test isolation.
  mockIsPending = false;
});
