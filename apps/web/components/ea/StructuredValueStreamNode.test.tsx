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
  it("renders only the value stream band shell and no embedded child stage markup", () => {
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
    expect(html).toContain("data-value-stream-band");
    expect(html).toContain("data-value-stream-header");
    expect(html).toContain("data-value-stream-title-block");
    expect(html).toContain("data-value-stream-meta-block");
    // Stage slot containers are present (for the flow renderer) but stage content is not embedded
    expect(html).toContain("data-value-stream-stage-slot");
    expect(html).not.toContain("Request");
    expect(html).not.toContain("Support");
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

  it("keeps the band free of inline drag controls", () => {
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

    expect(html).not.toContain('draggable="true"');
    expect(html).not.toContain("data-stage-drop-target");
    expect(html).not.toContain("data-stage-drag-preview");
    expect(html).not.toContain("Move stage right");
    expect(html).not.toContain("Move stage left");
  });
});
