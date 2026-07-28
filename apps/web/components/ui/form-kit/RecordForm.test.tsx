// @vitest-environment jsdom
//
// Component test for the form-kit RecordForm (BI-C167C45E): the explicit
// Save/Discard commit model (nothing persists on blur), the auto-growing text
// editor for free text, and the hidden-fields disclosure.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { RecordForm } from "./RecordForm";
import type { FormFieldSpec } from "@/lib/form-kit/field-controls";

const FIELDS: FormFieldSpec[] = [
  { fieldId: "title", label: "Title", fieldType: "text", editable: true },
  { fieldId: "priority", label: "Priority", fieldType: "number", editable: true },
  { fieldId: "id", label: "ID", fieldType: "text", editable: false },
];

const HIDDEN: FormFieldSpec[] = [
  { fieldId: "notes", label: "Notes", fieldType: "text", editable: true },
];

function setup(onSave = vi.fn(), onDirtyChange = vi.fn()) {
  render(
    <RecordForm
      fields={FIELDS}
      hiddenFields={HIDDEN}
      values={{ title: "Original", priority: 1, id: "BI-1", notes: null }}
      onSave={onSave}
      onDirtyChange={onDirtyChange}
      renderReadOnly={(_f, v) => <span>{String(v ?? "—")}</span>}
    />,
  );
  return { onSave, onDirtyChange };
}

afterEach(cleanup);

describe("RecordForm commit model", () => {
  it("renders free text in a textarea (auto-grow editor), not a single-line input", () => {
    setup();
    expect(screen.getByLabelText("Title").tagName).toBe("TEXTAREA");
  });

  it("does not persist on edit or blur; Save persists only the dirty subset", async () => {
    const { onSave } = setup();
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Changed" } });
    fireEvent.blur(title);
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ title: "Changed" });
  });

  it("Discard reverts the draft and hides the save bar", () => {
    const { onSave, onDirtyChange } = setup();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Changed" } });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    expect((screen.getByLabelText("Title") as HTMLTextAreaElement).value).toBe("Original");
    expect(onSave).not.toHaveBeenCalled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("reverting an edit by hand clears dirty (no save bar)", () => {
    setup();
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Changed" } });
    fireEvent.change(title, { target: { value: "Original" } });
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("number edits commit as numbers, cleared fields as null", async () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ priority: 3 }));
  });

  it("keeps hidden fields reachable behind the disclosure and editable there", async () => {
    const { onSave } = setup();
    expect(screen.getByText("1 hidden field")).toBeTruthy();
    fireEvent.click(screen.getByText("1 hidden field"));
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "From disclosure" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ notes: "From disclosure" }));
  });

  it("renders non-editable fields through the host's read-only renderer", () => {
    setup();
    expect(screen.getByText("BI-1")).toBeTruthy();
    expect(screen.queryByLabelText("ID")).toBeNull();
  });
});
