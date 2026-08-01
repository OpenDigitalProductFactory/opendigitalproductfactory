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
      {data.nodes.length > 0 && (
        <button type="button" onClick={() => onFocusChange(data.nodes[0].id)}>
          Inspect node
        </button>
      )}
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
