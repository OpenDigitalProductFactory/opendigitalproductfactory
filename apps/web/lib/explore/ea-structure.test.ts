import { describe, expect, it } from "vitest";

import {
  buildStructuredViewElements,
  filterStructuredEdges,
  listStructuredVisibleViewElementIds,
  type StructuredEdgeCandidate,
  type StructuredViewElementCandidate,
} from "./ea-structure";

describe("app ea structure helpers", () => {
  it("groups and orders child stages under a value stream", () => {
    const elements: StructuredViewElementCandidate[] = [
      {
        viewElementId: "stream-1",
        elementId: "el-stream-1",
        elementTypeSlug: "value_stream",
        parentViewElementId: null,
        orderIndex: null,
        rendererHint: "nested_chevron_sequence",
      },
      {
        viewElementId: "stage-2",
        elementId: "el-stage-2",
        elementTypeSlug: "value_stream_stage",
        parentViewElementId: "stream-1",
        orderIndex: 2,
        rendererHint: null,
      },
      {
        viewElementId: "stage-1",
        elementId: "el-stage-1",
        elementTypeSlug: "value_stream_stage",
        parentViewElementId: "stream-1",
        orderIndex: 1,
        rendererHint: null,
      },
    ];

    const structured = buildStructuredViewElements(elements);
    expect(structured[0]?.childViewElements.map((child) => child.viewElementId)).toEqual([
      "stage-1",
      "stage-2",
    ]);
  });

  it("hides implied stage-to-stage edges inside a structured value stream", () => {
    const elements: StructuredViewElementCandidate[] = [
      {
        viewElementId: "stream-1",
        elementId: "el-stream-1",
        elementTypeSlug: "value_stream",
        parentViewElementId: null,
        orderIndex: null,
        rendererHint: "nested_chevron_sequence",
      },
      {
        viewElementId: "stage-1",
        elementId: "el-stage-1",
        elementTypeSlug: "value_stream_stage",
        parentViewElementId: "stream-1",
        orderIndex: 0,
        rendererHint: null,
      },
      {
        viewElementId: "stage-2",
        elementId: "el-stage-2",
        elementTypeSlug: "value_stream_stage",
        parentViewElementId: "stream-1",
        orderIndex: 1,
        rendererHint: null,
      },
    ];

    const edges: StructuredEdgeCandidate[] = [
      { id: "edge-1", fromViewElementId: "stage-1", toViewElementId: "stage-2", relationshipTypeSlug: "flows_to" },
      { id: "edge-2", fromViewElementId: "stream-1", toViewElementId: "stage-1", relationshipTypeSlug: "composed_of" },
    ];

    expect(filterStructuredEdges(edges, buildStructuredViewElements(elements)).map((edge) => edge.id)).toEqual([
      "edge-2",
    ]);
  });

  it("keeps structured stage nodes visible while preserving parent-child grouping", () => {
    const elements: StructuredViewElementCandidate[] = [
      {
        viewElementId: "stream-1",
        elementId: "el-stream-1",
        elementTypeSlug: "value_stream",
        parentViewElementId: null,
        orderIndex: null,
        rendererHint: "nested_chevron_sequence",
      },
      {
        viewElementId: "stage-1",
        elementId: "el-stage-1",
        elementTypeSlug: "value_stream_stage",
        parentViewElementId: "stream-1",
        orderIndex: 0,
        rendererHint: null,
      },
    ];

    const structured = buildStructuredViewElements(elements);

    expect(listStructuredVisibleViewElementIds(structured)).toEqual([
      "stream-1",
      "stage-1",
    ]);
  });
});
