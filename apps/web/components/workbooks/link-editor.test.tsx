// @vitest-environment jsdom
//
// Component test for the link-cell multi-select editor — drives the typeahead
// (search → pick) and asserts it commits the chosen record as a ReferenceValue[]
// via onRowChange(value, /* commitChanges */ true), and that cardinality "one"
// replaces rather than appends.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("@/lib/actions/workbooks", () => ({
  searchReferencesAction: vi.fn(async () => ({
    ok: true,
    data: [{ id: "E1", label: "Epic One" }],
  })),
}));

import { makeLinkEditor } from "./cell-editors";

afterEach(() => cleanup());

describe("link cell editor", () => {
  it("appends a picked record as a ReferenceValue[] and commits", async () => {
    const Editor = makeLinkEditor({ cardinality: "many", referenceType: "epic" });
    const onRowChange = vi.fn();
    const row = { rowId: "r1", c1: [] };
    const column = { key: "c1" } as never;

    render(<Editor row={row} column={column} onRowChange={onRowChange} onClose={vi.fn()} rowIdx={0} /> as never);

    fireEvent.change(screen.getByPlaceholderText("Search…"), { target: { value: "epic" } });
    fireEvent.click(await screen.findByText("Epic One"));

    await waitFor(() => expect(onRowChange).toHaveBeenCalled());
    expect(onRowChange).toHaveBeenCalledWith(
      { rowId: "r1", c1: [{ referenceId: "E1", referenceType: "epic", label: "Epic One" }] },
      true,
    );
  });

  it("replaces the existing link when cardinality is 'one'", async () => {
    const Editor = makeLinkEditor({ cardinality: "one", referenceType: "epic" });
    const onRowChange = vi.fn();
    const row = { rowId: "r1", c1: [{ referenceId: "E0", referenceType: "epic", label: "Old" }] };
    const column = { key: "c1" } as never;

    render(<Editor row={row} column={column} onRowChange={onRowChange} onClose={vi.fn()} rowIdx={0} /> as never);

    fireEvent.change(screen.getByPlaceholderText("Search…"), { target: { value: "epic" } });
    fireEvent.click(await screen.findByText("Epic One"));

    await waitFor(() => expect(onRowChange).toHaveBeenCalled());
    expect(onRowChange).toHaveBeenCalledWith(
      { rowId: "r1", c1: [{ referenceId: "E1", referenceType: "epic", label: "Epic One" }] },
      true,
    );
  });
});
