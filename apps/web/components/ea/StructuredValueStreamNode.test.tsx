import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StructuredValueStreamNode } from "./StructuredValueStreamNode";
import type { SerializedViewElement } from "@/lib/ea-types";

function buildStage(
  viewElementId: string,
  name: string,
  orderIndex: number,
  structureIssueCount = 0,
): SerializedViewElement {
  return {
    viewElementId,
    elementId: `element-${viewElementId}`,
    mode: "reference",
    parentViewElementId: "stream-1",
    orderIndex,
    rendererHint: null,
    structureIssueCount,
    proposedProperties: null,
    elementType: {
      slug: "value_stream_stage",
      name: "Value Stream Stage",
      neoLabel: "ArchiMate__ValueStreamStage",
    },
    element: {
      name,
      description: null,
      lifecycleStage: "plan",
      lifecycleStatus: "draft",
      properties: null,
    },
    childViewElements: [],
  };
}

describe("StructuredValueStreamNode", () => {
  it("renders a directional value stream band with a compact header row and ordered nested stage chevrons", () => {
    const html = renderToStaticMarkup(
      <StructuredValueStreamNode
        selected={false}
        data={{
          viewElementId: "stream-1",
          elementId: "element-stream-1",
          mode: "reference",
          parentViewElementId: null,
          orderIndex: null,
          rendererHint: "nested_chevron_sequence",
          structureIssueCount: 0,
          proposedProperties: null,
          elementType: {
            slug: "value_stream",
            name: "Value Stream",
            neoLabel: "ArchiMate__ValueStream",
          },
          element: {
            name: "Deliver Workforce Services",
            description: null,
            lifecycleStage: "plan",
            lifecycleStatus: "draft",
            properties: null,
          },
          childViewElements: [
            buildStage("stage-2", "Support", 1),
            buildStage("stage-1", "Request", 0),
          ],
        }}
      />,
    );

    expect(html).toContain("Deliver Workforce Services");
    expect(html).toContain("Request");
    expect(html).toContain("Support");
    expect(html.indexOf("Request")).toBeLessThan(html.indexOf("Support"));
    expect(html).toContain("value-stream-stage");
    expect(html).toContain("data-value-stream-band");
    expect(html).toContain("data-value-stream-header");
    expect(html).toContain("data-value-stream-title-block");
    expect(html).toContain("data-value-stream-meta-block");
    expect(html).not.toContain("Move stage left");
    expect(html).not.toContain("Move stage right");
  });

  it("renders a warning state when the structure is non-conformant", () => {
    const html = renderToStaticMarkup(
      <StructuredValueStreamNode
        selected
        data={{
          viewElementId: "stream-1",
          elementId: "element-stream-1",
          mode: "reference",
          parentViewElementId: null,
          orderIndex: null,
          rendererHint: "nested_chevron_sequence",
          structureIssueCount: 1,
          proposedProperties: null,
          elementType: {
            slug: "value_stream",
            name: "Value Stream",
            neoLabel: "ArchiMate__ValueStream",
          },
          element: {
            name: "Deliver Workforce Services",
            description: null,
            lifecycleStage: "plan",
            lifecycleStatus: "draft",
            properties: null,
          },
          childViewElements: [buildStage("stage-1", "Request", 0, 1)],
        }}
      />,
    );

    expect(html).toContain("Structural warning");
    expect(html).toContain("1 issue");
  });

  it("marks editable stages as draggable reorder targets without inline controls", () => {
    const html = renderToStaticMarkup(
      <StructuredValueStreamNode
        selected={false}
        data={{
          viewElementId: "stream-1",
          elementId: "element-stream-1",
          mode: "reference",
          parentViewElementId: null,
          orderIndex: null,
          rendererHint: "nested_chevron_sequence",
          structureIssueCount: 0,
          proposedProperties: null,
          elementType: {
            slug: "value_stream",
            name: "Value Stream",
            neoLabel: "ArchiMate__ValueStream",
          },
          element: {
            name: "Deliver Workforce Services",
            description: null,
            lifecycleStage: "plan",
            lifecycleStatus: "draft",
            properties: null,
          },
          isReadOnly: false,
          onMoveStructuredChild: () => undefined,
          childViewElements: [
            buildStage("stage-1", "Request", 0),
            buildStage("stage-2", "Support", 1),
          ],
        }}
      />,
    );

    expect(html).toContain('draggable="true"');
    expect(html).toContain("data-stage-drop-target");
    expect(html).toContain("data-stage-drag-preview");
    expect(html).not.toContain("Move stage right");
    expect(html).not.toContain("Move stage left");
  });
});
