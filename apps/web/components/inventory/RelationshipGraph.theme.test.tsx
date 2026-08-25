// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { RelationshipGraph } from "./RelationshipGraph";
import type { GraphData } from "@/lib/actions/graph";

let fillStyles: string[] = [];
let strokeStyles: string[] = [];
let alphas: number[] = [];

beforeAll(() => {
  const noop = () => {};
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({
      clearRect: noop, beginPath: noop, fill: noop, stroke: noop, moveTo: noop,
      lineTo: noop, arc: noop, fillText: noop,
      measureText: (text: string) => ({ width: text.length * 5 }),
      set fillStyle(value: string) { fillStyles.push(value); },
      set strokeStyle(value: string) { strokeStyles.push(value); },
      set globalAlpha(value: number) { alphas.push(value); },
      set lineWidth(_value: number) {}, set font(_value: string) {}, set textAlign(_value: string) {},
    }),
  });
  globalThis.requestAnimationFrame = (() => 0) as never;
  globalThis.cancelAnimationFrame = noop as never;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
});

beforeEach(() => {
  cleanup(); fillStyles = []; strokeStyles = []; alphas = [];
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    color: "rgb(18, 24, 32)",
    getPropertyValue: (name: string) => ({
      "--dpf-text": "rgb(18, 24, 32)",
      "--dpf-muted": "rgb(82, 96, 110)",
      "--dpf-border": "rgb(190, 198, 207)",
      "--dpf-surface-1": "rgb(250, 251, 252)",
      "--dpf-accent": "rgb(37, 99, 235)",
      "--dpf-success": "rgb(22, 163, 74)",
    })[name] ?? "",
  } as CSSStyleDeclaration);
});

describe("RelationshipGraph active theme", () => {
  it("draws muted labels and subdued links with computed tokens", () => {
    const data: GraphData = {
      nodes: [
        { id: "a", name: "Alpha", label: "Data", color: "rgb(37, 99, 235)", size: 7 },
        { id: "b", name: "Beta", label: "Data", color: "rgb(22, 163, 74)", size: 7 },
      ],
      links: [{ source: "a", target: "b", type: "RELATES_TO" }],
    };

    render(<RelationshipGraph data={data} nodeLegend={[]} linkLegend={[]} />);

    expect(fillStyles).toContain("rgb(82, 96, 110)");
    expect(strokeStyles).toContain("rgb(190, 198, 207)");
    expect(alphas.some((alpha) => alpha > 0 && alpha < 1)).toBe(true);
  });
});
