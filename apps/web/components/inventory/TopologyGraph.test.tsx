// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import * as React from "react";
import { getImpactData } from "@/lib/actions/graph";
import { TopologyGraph } from "./TopologyGraph";

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

  global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));

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
    vi.spyOn(React, "useTransition").mockReturnValue([true, vi.fn()]);

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
});
