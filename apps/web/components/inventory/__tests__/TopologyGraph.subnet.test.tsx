import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphData } from "@/lib/actions/graph";

const stateSlots: unknown[] = [];
const refSlots: Array<{ current: unknown }> = [];
const effectSlots: Array<{ deps?: unknown[]; cleanup?: () => void }> = [];
let stateCursor = 0;
let refCursor = 0;
let effectCursor = 0;
let pendingEffects: Array<() => void> = [];
let didScheduleRender = false;

const layoutCalls: Array<{
  data: GraphData;
  focusNodeId: string | null;
  dimensions: { width: number; height: number };
  scopeToken: string;
  viewName: string;
}> = [];
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
  didScheduleRender = false;
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
  refSlots.length = 0;
  effectSlots.splice(0).forEach((effect) => effect.cleanup?.());
  resetCursors();
  layoutCalls.length = 0;
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
      if (!Object.is(prev, resolved)) {
        stateSlots[index] = resolved;
        didScheduleRender = true;
      }
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
  useMemo: <T,>(factory: () => T) => factory(),
  useCallback: <T extends (...args: never[]) => unknown>(callback: T) => callback,
}));

vi.mock("@/lib/actions/graph", () => ({
  hasSubnetScopeNode: (data: GraphData, subnetId: string | null) => {
    if (!subnetId || subnetId === "all") {
      return false;
    }
    return data.nodes.some((node) => {
      if (node.id !== subnetId) {
        return false;
      }
      return node.ciType === "subnet" || node.ciType === "vlan";
    });
  },
  getSubnetScopeSignal: (data: GraphData, subnetId: string | null) => {
    if (!subnetId || subnetId === "all") {
      return "unscoped";
    }
    return data.nodes.some((node) => {
      if (node.id !== subnetId) {
        return false;
      }
      return node.ciType === "subnet" || node.ciType === "vlan";
    })
      ? "valid"
      : "invalid-scope";
  },
}));

vi.mock("@/lib/graph/use-graph-layout", () => ({
  useGraphLayout: (
    data: GraphData,
    view: { name: string },
    focusNodeId: string | null,
    dimensions: { width: number; height: number },
    scopeToken: string,
  ) => {
    layoutCalls.push({
      data,
      focusNodeId,
      dimensions,
      scopeToken,
      viewName: view.name,
    });
    return null;
  },
}));

vi.mock("@/lib/graph/device-icons", () => ({
  LEGEND_ENTRIES: [],
  getDeviceVisual: () => null,
}));

const topologyGraphModule = await import("@/components/inventory/TopologyGraph");
const {
  TopologyGraph,
  createScopeToken,
  resolveDisplayedGraphData,
  resolveSubnetScopeState,
} = topologyGraphModule;

const graphData: GraphData = {
  nodes: [
    { id: "subnet-a", name: "Subnet A", label: "InfraCI", color: "", size: 1, ciType: "subnet" },
    { id: "subnet-b", name: "Subnet B", label: "InfraCI", color: "", size: 1, ciType: "subnet" },
    { id: "host-a", name: "Host A", label: "InfraCI", color: "", size: 1, ciType: "host" },
    { id: "host-b", name: "Host B", label: "InfraCI", color: "", size: 1, ciType: "host" },
    { id: "gateway-a", name: "Gateway A", label: "InfraCI", color: "", size: 1, ciType: "gateway" },
  ],
  links: [
    { source: "host-a", target: "subnet-a", type: "MEMBER_OF" },
    { source: "host-b", target: "subnet-b", type: "MEMBER_OF" },
    { source: "subnet-a", target: "gateway-a", type: "ROUTES_THROUGH" },
    { source: "gateway-a", target: "host-a", type: "CONNECTS_TO" },
  ],
};

type ElementLike = {
  type?: unknown;
  props?: Record<string, unknown>;
};

function renderTopologyGraph(data: GraphData = graphData) {
  let tree: unknown;
  for (let iteration = 0; iteration < 10; iteration += 1) {
    resetCursors();
    tree = TopologyGraph({ data, defaultView: "subnet-topology" });
    flushEffects();
    if (!didScheduleRender) {
      return tree;
    }
  }
  throw new Error("TopologyGraph did not settle after rerender attempts.");
}

function findElement(
  node: unknown,
  predicate: (element: ElementLike) => boolean,
): ElementLike | null {
  if (node == null || typeof node === "boolean") {
    return null;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child, predicate);
      if (match) {
        return match;
      }
    }
    return null;
  }
  if (typeof node === "string" || typeof node === "number") {
    return null;
  }

  const element = node as ElementLike;
  if (predicate(element)) {
    return element;
  }

  return findElement(element.props?.children, predicate);
}

function collectText(node: unknown): string[] {
  if (node == null || typeof node === "boolean") {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap((child) => collectText(child));
  }
  if (typeof node === "string" || typeof node === "number") {
    return [String(node)];
  }

  return collectText((node as ElementLike).props?.children);
}

function findAllElements(
  node: unknown,
  predicate: (element: ElementLike) => boolean,
): ElementLike[] {
  if (node == null || typeof node === "boolean") {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap((child) => findAllElements(child, predicate));
  }
  if (typeof node === "string" || typeof node === "number") {
    return [];
  }

  const element = node as ElementLike;
  return [
    ...(predicate(element) ? [element] : []),
    ...findAllElements(element.props?.children, predicate),
  ];
}

beforeEach(() => {
  globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;
});

afterEach(() => {
  resetHookState();
  vi.clearAllMocks();
});

describe("TopologyGraph subnet scope", () => {
  it("selecting a subnet updates displayed nodes and links immediately", () => {
    const displayed = resolveDisplayedGraphData(
      graphData,
      "subnet-topology",
      "subnet-a",
      null,
      0,
    );

    expect(displayed.nodes.map((node) => node.id).sort()).toEqual([
      "gateway-a",
      "host-a",
      "subnet-a",
    ]);
    expect(displayed.links).toEqual([
      { source: "host-a", target: "subnet-a", type: "MEMBER_OF" },
      { source: "subnet-a", target: "gateway-a", type: "ROUTES_THROUGH" },
      { source: "gateway-a", target: "host-a", type: "CONNECTS_TO" },
    ]);
  });

  it("switching subnets fully replaces the prior scoped graph state", () => {
    const firstScope = resolveSubnetScopeState(graphData, "subnet-topology", "subnet-a");
    const secondScope = resolveSubnetScopeState(graphData, "subnet-topology", "subnet-b");

    expect(firstScope.graphData.nodes.map((node) => node.id).sort()).toEqual([
      "gateway-a",
      "host-a",
      "subnet-a",
    ]);
    expect(secondScope.graphData.nodes.map((node) => node.id).sort()).toEqual([
      "host-b",
      "subnet-b",
    ]);
    expect(createScopeToken(1, "subnet-topology", "subnet-a")).not.toBe(
      createScopeToken(2, "subnet-topology", "subnet-b"),
    );
  });

  it("rapidly switching subnets passes only the latest scoped graph and token to layout", () => {
    let tree = renderTopologyGraph();

    const subnetSelect = findElement(
      tree,
      (element) => element.props?.["aria-label"] === "Filter graph by subnet",
    );
    expect(subnetSelect).not.toBeNull();

    const onChange = subnetSelect?.props?.onChange as
      | ((event: { target: { value: string } }) => void)
      | undefined;
    expect(onChange).toBeTypeOf("function");

    onChange?.({ target: { value: "subnet-a" } });
    tree = renderTopologyGraph();

    onChange?.({ target: { value: "subnet-b" } });
    tree = renderTopologyGraph();

    expect(layoutCalls[0]?.scopeToken).toBe("subnet-topology:all:0");
    expect(
      Array.from(new Set(layoutCalls.map((call) => call.scopeToken))).slice(-2),
    ).toEqual(["subnet-topology:subnet-a:1", "subnet-topology:subnet-b:2"]);

    const latestCall = layoutCalls.at(-1);
    expect(latestCall?.viewName).toBe("subnet-topology");
    expect(latestCall?.focusNodeId).toBeNull();
    expect(latestCall?.dimensions).toEqual({ width: 800, height: 500 });
    expect(latestCall?.data.nodes.map((node) => node.id).sort()).toEqual([
      "host-b",
      "subnet-b",
    ]);
    expect(latestCall?.data.links).toEqual([
      { source: "host-b", target: "subnet-b", type: "MEMBER_OF" },
    ]);

    const staleNodeIds = new Set(latestCall?.data.nodes.map((node) => node.id));
    expect(staleNodeIds.has("subnet-a")).toBe(false);
    expect(staleNodeIds.has("host-a")).toBe(false);
    expect(staleNodeIds.has("gateway-a")).toBe(false);

    expect(collectText(tree)).toContain("Scoped to ");
    expect(collectText(tree)).toContain("Subnet B");
  });

  it("reset returns the displayed graph to the full dataset", () => {
    const displayed = resolveDisplayedGraphData(
      graphData,
      "subnet-topology",
      null,
      null,
      0,
    );
    const scopeState = resolveSubnetScopeState(graphData, "subnet-topology", null);

    expect(scopeState.invalidScope).toBe(false);
    expect(scopeState.activeSubnetId).toBeNull();
    expect(scopeState.graphData).toBe(graphData);
    expect(displayed).toEqual(graphData);
  });

  it("auto-resets to the full graph when refresh removes the active subnet", () => {
    let tree = renderTopologyGraph();

    const subnetSelect = findElement(
      tree,
      (element) => element.props?.["aria-label"] === "Filter graph by subnet",
    );
    const onChange = subnetSelect?.props?.onChange as
      | ((event: { target: { value: string } }) => void)
      | undefined;

    onChange?.({ target: { value: "subnet-a" } });
    tree = renderTopologyGraph();

    const refreshedGraph: GraphData = {
      nodes: graphData.nodes.filter((node) => node.id !== "subnet-a"),
      links: graphData.links.filter(
        (link) => link.source !== "subnet-a" && link.target !== "subnet-a",
      ),
    };

    tree = renderTopologyGraph(refreshedGraph);

    const liveRegion = findElement(
      tree,
      (element) => element.props?.["aria-live"] === "polite",
    );
    expect(collectText(liveRegion)).toEqual(["Viewing full graph (4 nodes)"]);

    const resetButton = findElement(
      tree,
      (element) => element.props?.["aria-label"] === "Reset subnet scope",
    );
    expect(resetButton?.props?.disabled).toBe(true);

    const latestCall = layoutCalls.at(-1);
    expect(latestCall?.scopeToken).toBe("subnet-topology:all:2");
    expect(latestCall?.data).toEqual(refreshedGraph);
    expect(collectText(tree)).not.toContain("Scoped to ");
  });

  it("subnet selector and reset control expose accessible names and keyboard handlers", () => {
    let tree = renderTopologyGraph();

    const subnetSelect = findElement(
      tree,
      (element) => element.props?.["aria-label"] === "Filter graph by subnet",
    );
    expect(subnetSelect).not.toBeNull();
    expect(subnetSelect?.type).toBe("select");
    expect(subnetSelect?.props?.onKeyDown).toBeTypeOf("function");

    const selectOnChange = subnetSelect?.props?.onChange as
      | ((event: { target: { value: string } }) => void)
      | undefined;
    const selectOnKeyDown = subnetSelect?.props?.onKeyDown as
      | ((event: { key: string; currentTarget: { value: string } }) => void)
      | undefined;

    selectOnChange?.({ target: { value: "subnet-a" } });
    tree = renderTopologyGraph();

    const resetButton = findElement(
      tree,
      (element) => element.props?.["aria-label"] === "Reset subnet scope",
    );
    expect(resetButton).not.toBeNull();
    expect(resetButton?.type).toBe("button");
    expect(resetButton?.props?.onKeyDown).toBeTypeOf("function");
    expect(resetButton?.props?.disabled).toBe(false);

    const resetOnKeyDown = resetButton?.props?.onKeyDown as
      | ((event: { key: string; preventDefault: () => void }) => void)
      | undefined;

    resetOnKeyDown?.({ key: "Enter", preventDefault: () => undefined });
    tree = renderTopologyGraph();
    expect(collectText(tree)).not.toContain("Scoped to ");

    selectOnKeyDown?.({ key: "Enter", currentTarget: { value: "subnet-b" } });
    tree = renderTopologyGraph();
    expect(collectText(tree)).toContain("Scoped to ");
    expect(collectText(tree)).toContain("Subnet B");
  });

  it("announces subnet and full-graph scope transitions through the live region", () => {
    let tree = renderTopologyGraph();
    const liveRegions = findAllElements(
      tree,
      (element) => element.props?.["aria-live"] === "polite",
    );
    expect(liveRegions).toHaveLength(1);
    expect(collectText(liveRegions[0])).toEqual(["Viewing full graph (5 nodes)"]);

    const subnetSelect = findElement(
      tree,
      (element) => element.props?.["aria-label"] === "Filter graph by subnet",
    );
    const onChange = subnetSelect?.props?.onChange as
      | ((event: { target: { value: string } }) => void)
      | undefined;
    onChange?.({ target: { value: "subnet-a" } });
    tree = renderTopologyGraph();

    const scopedLiveRegion = findElement(
      tree,
      (element) => element.props?.["aria-live"] === "polite",
    );
    expect(collectText(scopedLiveRegion)).toEqual(["Viewing subnet Subnet A (3 nodes)"]);

    const resetButton = findElement(
      tree,
      (element) => element.props?.["aria-label"] === "Reset subnet scope",
    );
    const resetOnClick = resetButton?.props?.onClick as (() => void) | undefined;
    resetOnClick?.();
    tree = renderTopologyGraph();

    const resetLiveRegion = findElement(
      tree,
      (element) => element.props?.["aria-live"] === "polite",
    );
    expect(collectText(resetLiveRegion)).toEqual(["Viewing full graph (5 nodes)"]);
  });
});
