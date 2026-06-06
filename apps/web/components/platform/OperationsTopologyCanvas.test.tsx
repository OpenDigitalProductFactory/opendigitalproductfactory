// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { OperationsTopologyCanvas } from "./OperationsTopologyCanvas";
import { buildOperationsMapTopologyFixture } from "@/test-support/operations-map-fixture";

afterEach(() => cleanup());

describe("OperationsTopologyCanvas — provider parity (Stage B1)", () => {
  it("renders one spine row per routing coworker and one node per provider", () => {
    const { container } = render(<OperationsTopologyCanvas topology={buildOperationsMapTopologyFixture()} />);
    // 3 coworkers participate (all have routes in the fixture).
    expect(container.querySelectorAll("[data-canvas-coworker-row]").length).toBe(3);
    // 2 providers.
    expect(container.querySelectorAll("[data-canvas-provider]").length).toBe(2);
  });

  it("renders every provider route with its state, accessible name, and arrowhead", () => {
    const { container } = render(<OperationsTopologyCanvas topology={buildOperationsMapTopologyFixture()} />);
    const routes = container.querySelectorAll("[data-canvas-route]");
    expect(routes.length).toBe(4);
    expect([...routes].map((r) => r.getAttribute("data-route-state")).sort()).toEqual([
      "active",
      "failover",
      "historical",
      "scheduled",
    ]);
    routes.forEach((r) => {
      expect(r.getAttribute("aria-label")).toMatch(/→.*(route|traffic)/i);
      expect(r.getAttribute("role")).toBe("button");
      expect(r.getAttribute("tabindex")).toBe("0");
    });
  });

  it("renders all markers including the unattributed provider-side one", () => {
    const { container } = render(<OperationsTopologyCanvas topology={buildOperationsMapTopologyFixture()} />);
    const markers = container.querySelectorAll("[data-canvas-marker]");
    // d1 decision (route-attached), d2 error (route-attached), unattributed (provider-side).
    expect(markers.length).toBe(3);
    expect(container.querySelector('[data-canvas-marker="marker:unattributed"]')).not.toBeNull();
  });

  it("marks the selected coworker row", () => {
    const { container } = render(
      <OperationsTopologyCanvas topology={buildOperationsMapTopologyFixture()} selectedCoworkerId="ceo-coworker" />,
    );
    const ceo = container.querySelector('[data-canvas-coworker-row="ceo-coworker"]');
    expect(ceo?.getAttribute("data-row-selected")).toBe("true");
  });

  it("renders an honest empty state when there is no routing activity", () => {
    const empty = buildOperationsMapTopologyFixture({ coworkers: [], providers: [], routes: [], a2aEdges: [], markers: [] });
    const { container } = render(<OperationsTopologyCanvas topology={empty} />);
    expect(container.textContent).toContain("No provider routing or coworker activity");
    expect(container.querySelectorAll("[data-canvas-route]").length).toBe(0);
  });
});

describe("OperationsTopologyCanvas — A2A arc half (Stage C)", () => {
  it("renders left-side A2A arcs on the same spine rows in both mode", () => {
    const { container } = render(<OperationsTopologyCanvas topology={buildOperationsMapTopologyFixture()} />);
    const arcs = container.querySelectorAll("[data-canvas-a2a-arc]");
    expect(arcs.length).toBe(3);
    expect([...arcs].map((a) => a.getAttribute("data-a2a-kind")).sort()).toEqual([
      "a2a-delegation",
      "a2a-handoff",
      "a2a-task-lineage",
    ]);
    expect([...arcs].map((a) => a.getAttribute("data-a2a-state")).sort()).toEqual(["active", "completed", "failed"]);
    arcs.forEach((a) => {
      expect(a.getAttribute("aria-label")).toMatch(/→.*\(.+\)/);
      expect(a.getAttribute("role")).toBe("button");
      expect(a.getAttribute("tabindex")).toBe("0");
    });
    // Both halves share one spine.
    expect(container.querySelectorAll("[data-canvas-route]").length).toBe(4);
    expect(container.querySelectorAll("[data-canvas-coworker-row]").length).toBe(3);
  });

  it("provider-only mode hides the A2A arcs but keeps routes", () => {
    const { container } = render(<OperationsTopologyCanvas topology={buildOperationsMapTopologyFixture()} dimension="provider" />);
    expect(container.querySelectorAll("[data-canvas-a2a-arc]").length).toBe(0);
    expect(container.querySelectorAll("[data-canvas-route]").length).toBe(4);
    expect(container.querySelectorAll("[data-canvas-provider]").length).toBe(2);
  });

  it("A2A-only mode renders arcs and the spine but no provider routes or nodes", () => {
    const { container } = render(<OperationsTopologyCanvas topology={buildOperationsMapTopologyFixture()} dimension="a2a" />);
    expect(container.querySelectorAll("[data-canvas-a2a-arc]").length).toBe(3);
    expect(container.querySelectorAll("[data-canvas-coworker-row]").length).toBe(3);
    expect(container.querySelectorAll("[data-canvas-route]").length).toBe(0);
    expect(container.querySelectorAll("[data-canvas-provider]").length).toBe(0);
    expect(container.querySelectorAll("[data-canvas-marker]").length).toBe(0);
  });
});
