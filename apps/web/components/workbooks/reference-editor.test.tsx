// @vitest-environment jsdom
//
// Component test for the reference-cell editor commit path — the integration the
// unit suites didn't cover and where the persist bug (PR #1817) hid. Renders the
// editor, drives the typeahead (search → pick), and asserts it commits the chosen
// ReferenceValue via onRowChange(value, /* commitChanges */ true).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

// The editor's onSearch proxies to this server action — mock it with canned hits.
vi.mock("@/lib/actions/workbooks", () => ({
  searchReferencesAction: vi.fn(async () => ({
    ok: true,
    data: [{ id: "P-1", label: "PostgreSQL Database" }],
  })),
}));

import { makeReferenceEditor } from "./cell-editors";

afterEach(() => cleanup());

describe("reference cell editor", () => {
  it("commits the picked reference via onRowChange(value, true)", async () => {
    const Editor = makeReferenceEditor("digital_product");
    const onRowChange = vi.fn();
    const row = { rowId: "r1", c1: null };
    const column = { key: "c1" } as never;

    render(<Editor row={row} column={column} onRowChange={onRowChange} onClose={vi.fn()} rowIdx={0} /> as never);

    fireEvent.change(screen.getByPlaceholderText("Search…"), { target: { value: "postgres" } });

    const option = await screen.findByText("PostgreSQL Database");
    fireEvent.click(option);

    await waitFor(() => expect(onRowChange).toHaveBeenCalled());
    expect(onRowChange).toHaveBeenCalledWith(
      { rowId: "r1", c1: { referenceId: "P-1", referenceType: "digital_product", label: "PostgreSQL Database" } },
      true,
    );
  });
});
