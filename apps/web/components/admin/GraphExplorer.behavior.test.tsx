// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  findGraphNodes: vi.fn(),
  loadGraphNeighbourhood: vi.fn(),
  loadGraphNodeDetail: vi.fn(),
}));

vi.mock("@/components/inventory/RelationshipGraph", () => ({
  RelationshipGraph: ({
    data,
    onFocusChange,
  }: {
    data: { nodes: Array<{ id: string }> };
    onFocusChange: (key: string | null) => void;
  }) => (
    <div>
      Graph canvas
      {data.nodes.map((node, index) => (
        <button key={node.id} type="button" onClick={() => onFocusChange(node.id)}>
          {index === 0 ? "Inspect node" : `Inspect ${node.id}`}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("@/lib/actions/graph-explorer", () => mocks);
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/graph-explorer",
}));

import { GraphExplorer } from "./GraphExplorer";

const census = {
  labels: [{ label: "DataModel", count: 3 }],
  relTypes: [{ relType: "USES", count: 2 }],
  nodeTotal: 3,
  edgeTotal: 2,
};
const node = {
  key: "node-1",
  name: "BacklogItem",
  detail: "Data model",
  labels: ["DataModel"],
};
const neighbourhood = {
  nodes: [node],
  edges: [],
  truncated: false,
  notice: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findGraphNodes.mockResolvedValue([node]);
  mocks.loadGraphNeighbourhood.mockResolvedValue(neighbourhood);
  mocks.loadGraphNodeDetail.mockResolvedValue({
    ...node,
    degree: 2,
    props: { table: "BacklogItem" },
  });
});

afterEach(() => cleanup());

async function chooseStartingPoint() {
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "BacklogItem" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.click(await screen.findByRole("button", { name: /BacklogItem/ }));
}

describe("GraphExplorer async purpose state", () => {
  it("restores a bounded exploration from server-parsed URL context", async () => {
    const { container } = render(
      <GraphExplorer
        census={census}
        initialPurposeContext={{
          seedKeys: ["node-1"],
          depth: 2,
          inspectedKey: "node-1",
        }}
      />,
    );

    expect(mocks.loadGraphNeighbourhood).toHaveBeenCalledWith(
      expect.objectContaining({ seedKeys: ["node-1"], depth: 2 }),
    );
    await waitFor(() =>
      expect(
        container
          .querySelector("[data-component='graph-explorer']")
          ?.getAttribute("data-dpf-purpose-state"),
      ).toBe("neighbourhood-drawn"),
    );
    const query = new URL(window.location.href).searchParams;
    expect(query.getAll("seed")).toEqual(["node-1"]);
    expect(query.get("depth")).toBe("2");
    expect(query.get("inspected")).toBe("node-1");
  });

  it("does not show stale no-match feedback beside a search failure", async () => {
    mocks.findGraphNodes.mockResolvedValueOnce([]);
    render(<GraphExplorer census={census} />);

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText(/Nothing matched/)).toBeTruthy();

    mocks.findGraphNodes.mockRejectedValueOnce(new Error("Search unavailable"));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "retry" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Search unavailable");
    expect(screen.queryByText(/Nothing matched/)).toBeNull();
  });

  it("returns to an honest starting state when neighbourhood loading fails", async () => {
    mocks.loadGraphNeighbourhood.mockRejectedValue(new Error("Graph unavailable"));
    const { container } = render(<GraphExplorer census={census} />);

    await chooseStartingPoint();

    expect((await screen.findByRole("alert")).textContent).toContain("Graph unavailable");
    expect(
      container
        .querySelector("[data-component='graph-explorer']")
        ?.getAttribute("data-dpf-purpose-state"),
    ).toBe("no-starting-point");
    expect(
      container.querySelector(
        "[data-dpf-purpose-completion-signal-key='graph-neighbourhood-visible']",
      ),
    ).toBeNull();
    expect(new URL(window.location.href).searchParams.has("seed")).toBe(false);
  });

  it("does not claim completion when node inspection fails", async () => {
    mocks.loadGraphNodeDetail.mockRejectedValue(new Error("Details unavailable"));
    const { container } = render(<GraphExplorer census={census} />);

    await chooseStartingPoint();
    fireEvent.click(await screen.findByRole("button", { name: "Inspect node" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Details unavailable");
    expect(
      container.querySelector(
        "[data-dpf-purpose-completion-signal-key='graph-neighbourhood-visible']",
      ),
    ).toBeNull();
  });

  it("marks completion only after a loaded node is inspected", async () => {
    const { container } = render(<GraphExplorer census={census} />);

    await chooseStartingPoint();
    fireEvent.click(await screen.findByRole("button", { name: "Inspect node" }));

    await waitFor(() => {
      expect(
        container
          .querySelector("[data-component='graph-explorer']")
          ?.getAttribute("data-dpf-purpose-state"),
      ).toBe("neighbourhood-drawn");
    });
    expect(
      container.querySelector(
        "[data-dpf-purpose-completion-signal-key='graph-neighbourhood-visible']",
      )?.getAttribute("data-dpf-purpose-key"),
    ).toBe("node-inspector");
    const purposeQuery = new URL(window.location.href).searchParams;
    expect(purposeQuery.getAll("seed")).toEqual(["node-1"]);
    expect(purposeQuery.get("depth")).toBe("1");
    expect(purposeQuery.get("inspected")).toBe("node-1");
  });

  it("clears prior completion while a replacement inspection fails", async () => {
    const secondNode = { ...node, key: "node-2", name: "Product" };
    mocks.loadGraphNeighbourhood.mockResolvedValue({
      ...neighbourhood,
      nodes: [node, secondNode],
    });
    let rejectSecond!: (reason: Error) => void;
    mocks.loadGraphNodeDetail.mockImplementation((key: string) =>
      key === node.key
        ? Promise.resolve({ ...node, degree: 2, props: {} })
        : new Promise((_resolve, reject) => {
            rejectSecond = reject;
          }),
    );
    const { container } = render(<GraphExplorer census={census} />);

    await chooseStartingPoint();
    fireEvent.click(await screen.findByRole("button", { name: "Inspect node" }));
    await waitFor(() =>
      expect(new URL(window.location.href).searchParams.get("inspected")).toBe(
        "node-1",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Inspect node-2" }));
    const inspector = container.querySelector(
      "[data-dpf-purpose-key='node-inspector']",
    );
    expect(inspector?.getAttribute("aria-busy")).toBe("true");
    expect(new URL(window.location.href).searchParams.has("inspected")).toBe(false);
    expect(
      container.querySelector(
        "[data-dpf-purpose-completion-signal-key='graph-neighbourhood-visible']",
      ),
    ).toBeNull();

    rejectSecond(new Error("Replacement unavailable"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Replacement unavailable",
    );
    expect(inspector?.getAttribute("aria-busy")).toBe("false");
    expect(new URL(window.location.href).searchParams.has("inspected")).toBe(false);
  });

  it("ignores an older inspection response after a newer selection completes", async () => {
    const secondNode = { ...node, key: "node-2", name: "Product" };
    mocks.loadGraphNeighbourhood.mockResolvedValue({
      ...neighbourhood,
      nodes: [node, secondNode],
    });
    const resolvers = new Map<
      string,
      (detail: typeof node & { degree: number; props: object }) => void
    >();
    mocks.loadGraphNodeDetail.mockImplementation(
      (key: string) =>
        new Promise((resolve) => {
          resolvers.set(key, resolve);
        }),
    );
    const { container } = render(<GraphExplorer census={census} />);

    await chooseStartingPoint();
    fireEvent.click(await screen.findByRole("button", { name: "Inspect node" }));
    fireEvent.click(screen.getByRole("button", { name: "Inspect node-2" }));
    resolvers.get("node-2")?.({ ...secondNode, degree: 1, props: {} });
    expect(await screen.findByText("Product")).toBeTruthy();
    resolvers.get("node-1")?.({ ...node, degree: 2, props: {} });

    await waitFor(() =>
      expect(new URL(window.location.href).searchParams.get("inspected")).toBe(
        "node-2",
      ),
    );
    expect(
      container.querySelector("[data-dpf-purpose-key='node-inspector']")
        ?.textContent,
    ).not.toContain("BacklogItem");
  });

  it("does not restore a pending inspection after reset", async () => {
    let resolveDetail!: (
      detail: typeof node & { degree: number; props: object },
    ) => void;
    mocks.loadGraphNodeDetail.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDetail = resolve;
        }),
    );
    const { container } = render(<GraphExplorer census={census} />);

    await chooseStartingPoint();
    fireEvent.click(await screen.findByRole("button", { name: "Inspect node" }));
    fireEvent.click(screen.getByRole("link", { name: "Reset" }));
    resolveDetail({ ...node, degree: 2, props: {} });

    await waitFor(() =>
      expect(new URL(window.location.href).searchParams.has("seed")).toBe(false),
    );
    expect(
      container.querySelector(
        "[data-dpf-purpose-completion-signal-key='graph-neighbourhood-visible']",
      ),
    ).toBeNull();
  });

  it("marks stale graph content busy while refreshing it", async () => {
    const { container } = render(<GraphExplorer census={census} />);
    await chooseStartingPoint();
    fireEvent.click(await screen.findByRole("button", { name: "Inspect node" }));
    await screen.findByText("2 links in the whole graph");

    mocks.loadGraphNeighbourhood.mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    fireEvent.click(screen.getByRole("button", { name: "2" }));

    await waitFor(() => {
      expect(
        container
          .querySelector("[data-dpf-purpose-key='graph-canvas']")
          ?.getAttribute("aria-busy"),
      ).toBe("true");
    });
    expect(
      container.querySelector("[data-dpf-purpose-key='graph-canvas'] .dpf-spin"),
    ).not.toBeNull();
  });
});
