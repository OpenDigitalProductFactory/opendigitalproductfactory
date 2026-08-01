/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CartesianSceneLayout } from "@dpf/storefront-templates";

vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    ReactFlow: (props: Record<string, any>) => (
      <div
        data-testid="react-flow"
        data-nodes-draggable={String(props.nodesDraggable)}
        data-elements-selectable={String(props.elementsSelectable)}
        data-pan-on-scroll={String(props.panOnScroll)}
        data-pan-on-drag={String(props.panOnDrag)}
        data-zoom-on-scroll={String(props.zoomOnScroll)}
        data-zoom-on-pinch={String(props.zoomOnPinch)}
        data-zoom-on-double-click={String(props.zoomOnDoubleClick)}
      >
        {props.nodes.map((node: Record<string, any>) => {
          const NodeComponent = props.nodeTypes[node.type];
          return NodeComponent ? (
            <NodeComponent key={node.id} data={node.data} selected={false} />
          ) : null;
        })}
        {props.nodes.find((node: Record<string, any>) =>
          node.id.startsWith("scene-placement:"),
        ) ? (
          <button
            type="button"
            onClick={() => {
              const node = props.nodes.find((candidate: Record<string, any>) =>
                candidate.id.startsWith("scene-placement:"),
              );
              props.onNodeDragStop?.(
                {},
                { ...node, position: { x: 140, y: 160 } },
              );
            }}
          >
            Simulate drag
          </button>
        ) : null}
        {props.children}
      </div>
    ),
    Background: () => <span data-testid="background" />,
    Controls: () => <span data-testid="controls" />,
    useNodesState: (initial: unknown[]) => {
      const [nodes, setNodes] = React.useState(initial);
      return [nodes, setNodes, vi.fn()];
    },
  };
});

import { CartesianSceneCanvas } from "./CartesianSceneCanvas";

function scene(): CartesianSceneLayout {
  return {
    schemaVersion: 1,
    spaceKind: "cartesian-interior",
    viewport: { x: 0, y: 0, zoom: 1 },
    zones: [],
    placements: [
      {
        id: "table-1",
        label: "Table 1",
        entityRef: { kind: "table", id: "resource-1" },
        geometry: {
          x: 40,
          y: 60,
          width: 72,
          height: 72,
          rotation: 0,
          shapeKind: "round-table",
        },
      },
    ],
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CartesianSceneCanvas", () => {
  it("exposes only caller-authorized local modes", () => {
    const onModeChange = vi.fn();
    render(
      <CartesianSceneCanvas
        ariaLabel="Dining room layout"
        mode="operate"
        modeOptions={["operate", "configure"]}
        onModeChange={onModeChange}
        scene={scene()}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Layout mode" });
    expect(select).toHaveValue("operate");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.change(select, { target: { value: "configure" } });
    expect(onModeChange).toHaveBeenCalledWith("configure");
  });

  it("debounces configure-mode drag saves and advances the optimistic version", async () => {
    vi.useFakeTimers();
    const onSave = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, version: 3 })
      .mockResolvedValueOnce({ ok: true, version: 4 });

    render(
      <CartesianSceneCanvas
        ariaLabel="Dining room layout"
        mode="configure"
        scene={scene()}
        persistence={{ sceneId: "scene-1", version: 2, onSave }}
      />,
    );

    expect(screen.getByTestId("react-flow")).toHaveAttribute(
      "data-nodes-draggable",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Simulate drag" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_499);
    });
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onSave).toHaveBeenCalledWith({
      sceneId: "scene-1",
      expectedVersion: 2,
      layout: expect.objectContaining({
        placements: [
          expect.objectContaining({
            geometry: expect.objectContaining({ x: 140, y: 160 }),
          }),
        ],
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Simulate drag" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedVersion: 3 }),
    );
  });

  it("locks operate geometry while exposing status, cog recommendation, and activation", () => {
    const onActivate = vi.fn();
    render(
      <CartesianSceneCanvas
        ariaLabel="Dining room layout"
        mode="operate"
        scene={scene()}
        bindings={{
          "table:resource-1": {
            label: "Table 1",
            statusLabel: "Turning soon",
            sublabel: "Free in 8 minutes",
            intent: "warning",
            cogSuggested: true,
          },
        }}
        onActivate={onActivate}
      />,
    );

    expect(screen.getByTestId("react-flow")).toHaveAttribute(
      "data-nodes-draggable",
      "false",
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /Table 1.*Turning soon.*Free in 8 minutes.*Recommended/i,
      }),
    );
    expect(onActivate).toHaveBeenCalledWith("table-1", {
      kind: "table",
      id: "resource-1",
    });
    expect(
      screen.getByRole("list", { name: "Dining room layout details" }),
    ).toHaveTextContent("Table 1: Turning soon — Free in 8 minutes");
  });

  it("supports a chrome-free locked embed while keeping resource activation", () => {
    const onActivate = vi.fn();
    render(
      <CartesianSceneCanvas
        ariaLabel="Host stand floor"
        mode="operate"
        scene={scene()}
        chrome="embedded"
        navigation="locked"
        bindings={{
          "table:resource-1": {
            label: "Table 1",
            statusLabel: "Available",
            intent: "success",
          },
        }}
        onActivate={onActivate}
      />,
    );

    const flow = screen.getByTestId("react-flow");
    expect(flow).toHaveAttribute("data-pan-on-scroll", "false");
    expect(flow).toHaveAttribute("data-pan-on-drag", "false");
    expect(flow).toHaveAttribute("data-zoom-on-scroll", "false");
    expect(flow).toHaveAttribute("data-zoom-on-pinch", "false");
    expect(flow).toHaveAttribute("data-zoom-on-double-click", "false");
    expect(screen.queryByText("Live operation")).not.toBeInTheDocument();
    expect(screen.queryByTestId("controls")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Host stand floor details" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Table 1.*Available/i }));
    expect(onActivate).toHaveBeenCalledWith("table-1", {
      kind: "table",
      id: "resource-1",
    });
  });

  it("has no mutation or activation affordance in read-only mode", () => {
    const onActivate = vi.fn();
    render(
      <CartesianSceneCanvas
        ariaLabel="Customer table availability"
        mode="read-only"
        scene={scene()}
        bindings={{
          "table:resource-1": {
            label: "Table 1",
            statusLabel: "Available",
            intent: "success",
          },
        }}
        onActivate={onActivate}
      />,
    );

    expect(screen.getByTestId("react-flow")).toHaveAttribute(
      "data-elements-selectable",
      "false",
    );
    expect(
      screen.queryByRole("button", { name: /Table 1.*Available/i }),
    ).not.toBeInTheDocument();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("rolls back a failed save and exposes Retry and Revert", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue({
      ok: false,
      code: "conflict",
      error:
        "This layout changed in another session. Refresh before moving more resources.",
    });
    render(
      <CartesianSceneCanvas
        ariaLabel="Dining room layout"
        mode="configure"
        scene={scene()}
        persistence={{ sceneId: "scene-1", version: 2, onSave }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Simulate drag" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This layout changed in another session",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revert" })).toBeInTheDocument();
  });

  it("renders an honest empty state without mounting an empty canvas", () => {
    render(
      <CartesianSceneCanvas
        ariaLabel="Dining room layout"
        mode="read-only"
        scene={{ ...scene(), placements: [] }}
        empty={<p>No resources are placed yet.</p>}
      />,
    );

    expect(screen.getByText("No resources are placed yet.")).toBeInTheDocument();
    expect(screen.queryByTestId("react-flow")).not.toBeInTheDocument();
  });
});
