import { describe, expect, it } from "vitest";

import {
  deriveNestedChevronSequenceWarnings,
  sortStructuredChildren,
  type StructuredChildRecord,
} from "./ea-structure";

describe("ea structure helpers", () => {
  it("sorts ordered children by order index", () => {
    const children: StructuredChildRecord[] = [
      { viewElementId: "stage-2", elementId: "el-2", elementTypeSlug: "value_stream_stage", parentViewElementId: "stream-1", orderIndex: 2 },
      { viewElementId: "stage-0", elementId: "el-0", elementTypeSlug: "value_stream_stage", parentViewElementId: "stream-1", orderIndex: 0 },
      { viewElementId: "stage-1", elementId: "el-1", elementTypeSlug: "value_stream_stage", parentViewElementId: "stream-1", orderIndex: 1 },
    ];

    expect(sortStructuredChildren(children).map((child) => child.viewElementId)).toEqual([
      "stage-0",
      "stage-1",
      "stage-2",
    ]);
  });

  it("warns when a stage is detached from its value stream", () => {
    const warnings = deriveNestedChevronSequenceWarnings({
      parentViewElementId: "stream-1",
      minChildren: 1,
      children: [
        { viewElementId: "stage-1", elementId: "el-1", elementTypeSlug: "value_stream_stage", parentViewElementId: null, orderIndex: 0 },
      ],
    });

    expect(warnings.map((warning) => warning.issueType)).toContain("detached_child");
  });

  it("warns when sibling stages reuse the same order index", () => {
    const warnings = deriveNestedChevronSequenceWarnings({
      parentViewElementId: "stream-1",
      minChildren: 1,
      children: [
        { viewElementId: "stage-1", elementId: "el-1", elementTypeSlug: "value_stream_stage", parentViewElementId: "stream-1", orderIndex: 0 },
        { viewElementId: "stage-2", elementId: "el-2", elementTypeSlug: "value_stream_stage", parentViewElementId: "stream-1", orderIndex: 0 },
      ],
    });

    expect(warnings.map((warning) => warning.issueType)).toContain("duplicate_order_index");
  });
});
