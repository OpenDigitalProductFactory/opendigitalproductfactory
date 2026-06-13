// @vitest-environment jsdom
//
// Component test for the add-column UI for the Phase-2 field types (reference /
// formula / lookup). Guards that the picker shows the right config controls and
// that the column is created with the correct fieldConfig — the wiring that backs
// W-REF-1, W-FORMULA, and W-LOOKUP in the Phase-W audit checklist.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const addColumnAction = vi.fn(async (..._args: unknown[]) => ({ ok: true, data: { columnId: "COL-1" } }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/workbooks", () => ({
  addColumnAction: (...args: unknown[]) => addColumnAction(...args),
  listReferenceTargetsAction: vi.fn(async () => ({
    ok: true,
    data: [{ entityType: "digital_product", label: "Digital products" }],
  })),
  getReferenceTargetFieldsAction: vi.fn(async () => ({ ok: true, data: [{ field: "name", name: "Name" }] })),
}));

import { AddColumnButton } from "./AddColumnButton";

afterEach(() => {
  cleanup();
  addColumnAction.mockClear();
});

describe("AddColumnButton — reference column", () => {
  it("shows the target picker and creates the column with fieldConfig.referenceType", async () => {
    render(<AddColumnButton workbookId="WB-1" tableId="TBL-1" columns={[]} />);

    fireEvent.click(screen.getByText("+ Add column"));
    fireEvent.change(screen.getByPlaceholderText("Column name"), { target: { value: "Related product" } });
    // The field-type select is the first (only) combobox before a target picker appears.
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "reference" } });

    // Target picker appears + populates from listReferenceTargetsAction (the last combobox).
    await waitFor(() => {
      const combos = screen.getAllByRole("combobox");
      const picker = combos[combos.length - 1] as HTMLSelectElement;
      expect(picker.querySelector('option[value="digital_product"]')).toBeTruthy();
    });
    const picker = screen.getAllByRole("combobox").at(-1) as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: "digital_product" } });

    fireEvent.click(screen.getByText("Add"));

    await waitFor(() => expect(addColumnAction).toHaveBeenCalled());
    expect(addColumnAction).toHaveBeenCalledWith(
      "WB-1",
      "TBL-1",
      expect.objectContaining({
        name: "Related product",
        fieldType: "reference",
        config: expect.objectContaining({ referenceType: "digital_product" }),
      }),
    );
  });

  it("creates a formula column carrying the formula in fieldConfig", async () => {
    render(<AddColumnButton workbookId="WB-1" tableId="TBL-1" columns={[]} />);
    fireEvent.click(screen.getByText("+ Add column"));
    fireEvent.change(screen.getByPlaceholderText("Column name"), { target: { value: "Total" } });
    const combos = screen.getAllByRole("combobox");
    fireEvent.change(combos[0], { target: { value: "formula" } });
    fireEvent.change(await screen.findByPlaceholderText(/Formula/i), { target: { value: "=Price*Qty" } });
    fireEvent.click(screen.getByText("Add"));
    await waitFor(() => expect(addColumnAction).toHaveBeenCalled());
    expect(addColumnAction).toHaveBeenCalledWith(
      "WB-1",
      "TBL-1",
      expect.objectContaining({ fieldType: "formula", config: expect.objectContaining({ formula: "=Price*Qty" }) }),
    );
  });
});
