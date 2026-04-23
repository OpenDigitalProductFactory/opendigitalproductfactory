import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Handle: ({ id }: { id: string }) => <span data-testid={id} />,
  Position: {
    Top: "top",
    Right: "right",
    Bottom: "bottom",
    Left: "left",
  },
}));

import { ReactFlowProvider } from "@xyflow/react";

import type { SerializedViewElement } from "@/lib/ea-types";

import { ValueStreamStageNode } from "./ValueStreamStageNode";

function buildStageData(): SerializedViewElement {
  return {
    viewElementId: "stage-1",
    elementId: "element-stage-1",
    mode: "reference",
    parentViewElementId: "stream-1",
    orderIndex: 0,
    rendererHint: null,
    layoutRole: "stream_stage",
    structureIssueCount: 0,
    proposedProperties: null,
    elementType: {
      slug: "value_stream_stage",
      name: "Value Stream Stage",
      neoLabel: "ArchiMate__ValueStreamStage",
    },
    element: {
      name: "Request",
      description: null,
      lifecycleStage: "plan",
      lifecycleStatus: "draft",
      properties: null,
    },
    childViewElements: [],
  };
}

describe("ValueStreamStageNode", () => {
  it("renders a stage chevron node with four handles", () => {
    const html = renderToStaticMarkup(
      <ReactFlowProvider>
        <ValueStreamStageNode data={buildStageData()} selected={false} />
      </ReactFlowProvider>,
    );

    expect(html).toContain("data-value-stream-stage-node");
    expect(html).toContain("Request");
    expect(html).toContain("data-stage-handle-top");
    expect(html).toContain("data-stage-handle-right");
    expect(html).toContain("data-stage-handle-bottom");
    expect(html).toContain("data-stage-handle-left");
  });
});
