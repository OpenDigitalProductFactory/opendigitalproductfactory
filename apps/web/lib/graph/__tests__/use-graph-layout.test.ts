import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraphData } from "@/lib/actions/graph";
import type { LayoutResult } from "@/lib/graph/types";
import { VIEW_CONFIGS } from "@/lib/graph/view-config";

const stateSlots: unknown[] = [];
const stateUpdates: unknown[] = [];
const refSlots: Array<{ current: unknown }> = [];
const effectSlots: Array<{ deps?: unknown[]; cleanup?: () => void }> = [];
let stateCursor = 0;
let refCursor = 0;
let effectCursor = 0;
let pendingEffects: Array<() => void> = [];

const swimlaneResolvers: Array<(result: LayoutResult) => void> = [];
const hierarchicalResolvers: Array<(result: LayoutResult) => void> = [];

function depsChanged(prev: unknown[] | undefined, next: unknown[] | undefined) {
  if (prev == null || next == null) return true;
  if (prev.length !== next.length) return true;
  return prev.some((value, index) => !Object.is(value, next[index]));
}

function resetCursors() {
  stateCursor = 0;
  refCursor = 0;
  effectCursor = 0;
  pendingEffects = [];
}

function flushEffects() {
  const queue = pendingEffects;
  pendingEffects = [];
  for (const effect of queue) {
    effect();
  }
}

function resetHookState() {
  stateSlots.length = 0;
  stateUpdates.length = 0;
  refSlots.length = 0;
  effectSlots.splice(0).forEach((effect) => effect.cleanup?.());
  resetCursors();
  swimlaneResolvers.length = 0;
  hierarchicalResolvers.length = 0;
}

vi.mock("react", () => ({
  useState: <T,>(initial: T | (() => T)) => {
    const index = stateCursor++;
    if (!(index in stateSlots)) {
      stateSlots[index] =
        typeof initial === "function" ? (initial as () => T)() : initial;
    }
    const setState = (next: T | ((prev: T) => T)) => {
      const prev = stateSlots[index] as T;
      const resolved =
        typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
      stateSlots[index] = resolved;
      stateUpdates.push(resolved);
    };
    return [stateSlots[index] as T, setState] as const;
  },
  useRef: <T,>(initial: T) => {
    const index = refCursor++;
    if (!(index in refSlots)) {
      refSlots[index] = { current: initial };
    }
    return refSlots[index] as { current: T };
  },
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
    const index = effectCursor++;
    const previous = effectSlots[index];
    if (!previous || depsChanged(previous.deps, deps)) {
      pendingEffects.push(() => {
        previous?.cleanup?.();
        const cleanup = effect();
        effectSlots[index] = {
          deps,
          cleanup: typeof cleanup === "function" ? cleanup : undefined,
        };
      });
    }
  },
}));

vi.mock("@/lib/graph/layout-swimlane", () => ({
  computeSwimLaneLayout: vi.fn(
    () =>
      new Promise<LayoutResult>((resolve) => {
        swimlaneResolvers.push(resolve);
      }),
  ),
}));

vi.mock("@/lib/graph/layout-hierarchical", () => ({
  computeHierarchicalLayout: vi.fn(
    () =>
      new Promise<LayoutResult>((resolve) => {
        hierarchicalResolvers.push(resolve);
      }),
  ),
}));

import { useGraphLayout } from "@/lib/graph/use-graph-layout";

const graphData: GraphData = {
  nodes: [
    { id: "subnet-a", name: "Subnet A", label: "InfraCI", color: "", size: 1, ciType: "subnet" },
    { id: "host-a", name: "Host A", label: "InfraCI", color: "", size: 1, ciType: "host" },
  ],
  links: [{ source: "host-a", target: "subnet-a", type: "MEMBER_OF" }],
};

function renderHook(scopeToken: string, view: keyof typeof VIEW_CONFIGS = "subnet-topology") {
  resetCursors();
  const result = useGraphLayout(
    graphData,
    VIEW_CONFIGS[view],
    null,
    { width: 800, height: 500 },
    scopeToken,
  );
  flushEffects();
  return result;
}

async function flushAsyncLayout() {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  resetHookState();
  vi.clearAllMocks();
});

describe("useGraphLayout", () => {
  it("commits only the async layout result matching the latest scope token", async () => {
    const firstResult: LayoutResult = {
      nodes: [{ ...graphData.nodes[0], x: 10, y: 10 }],
      links: [],
    };
    const secondResult: LayoutResult = {
      nodes: [{ ...graphData.nodes[1], x: 20, y: 20 }],
      links: [],
    };

    renderHook("subnet-topology:subnet-a:1");
    renderHook("subnet-topology:subnet-b:2");

    expect(swimlaneResolvers).toHaveLength(2);

    swimlaneResolvers[1]?.(secondResult);
    await flushAsyncLayout();

    expect(stateUpdates).toContainEqual(secondResult);

    swimlaneResolvers[0]?.(firstResult);
    await flushAsyncLayout();

    expect(stateUpdates).not.toContainEqual(firstResult);
  });

  // The ELK-backed hierarchical layout is async (dagre retired, plan 2026-09-08 S10); it must
  // obey the same latest-request/latest-scope rule as the swimlane layout.
  it("commits only the latest async hierarchical layout", async () => {
    const stale: LayoutResult = { nodes: [{ ...graphData.nodes[0], x: 1, y: 1 }], links: [] };
    const fresh: LayoutResult = { nodes: [{ ...graphData.nodes[1], x: 2, y: 2 }], links: [] };

    renderHook("hosting-stack:1", "hosting-stack");
    renderHook("hosting-stack:2", "hosting-stack");

    expect(hierarchicalResolvers).toHaveLength(2);
    // The stale layout is cleared while the new one computes.
    expect(stateUpdates).toContain(null);

    hierarchicalResolvers[1]?.(fresh);
    await flushAsyncLayout();
    expect(stateUpdates).toContainEqual(fresh);

    hierarchicalResolvers[0]?.(stale);
    await flushAsyncLayout();
    expect(stateUpdates).not.toContainEqual(stale);
  });
});
