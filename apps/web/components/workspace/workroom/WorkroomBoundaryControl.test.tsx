// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveWorkroomBoundary } from "@/lib/actions/workroom-boundary";

vi.mock("@/lib/actions/workroom-boundary", () => ({
  saveWorkroomBoundary: vi.fn().mockResolvedValue({ ok: true }),
}));

import { WorkroomBoundaryControl } from "./WorkroomBoundaryControl";
afterEach(() => { cleanup(); vi.clearAllMocks(); });

// The defect being guarded is not "renders nothing" — it is "renders something
// INERT". The room listed eleven things it had not defined and offered no way
// to define any of them. So these assert a real control, and assert the §7.2
// shape: ONE repair action up front, not an eleven-field wizard.

function markup(current: unknown = null): string {
  return renderToStaticMarkup(
    React.createElement(WorkroomBoundaryControl, {
      caseKey: "WC-TEST0001",
      roomRowId: "room-1",
      current,
    } as never),
  );
}

describe("WorkroomBoundaryControl", () => {
  it("offers only canonical sensitivity choices after disclosure", () => {
    render(<WorkroomBoundaryControl caseKey="WC-TEST" roomRowId="row" current={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Define this room" }));
    fireEvent.click(screen.getByRole("button", { name: "More room details" }));
    const field = screen.getByRole("combobox", { name: "Sensitivity limit" }) as HTMLSelectElement;
    expect(Array.from(field.options).map(option => option.value)).toEqual(["", "public", "internal", "confidential", "restricted"]);
  });
  it("keeps an invalid historical value unresolved and preserves it on save", async () => {
    render(<WorkroomBoundaryControl caseKey="WC-TEST" roomRowId="row" current={{ sensitivityCeiling: "engineering-only" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Define this room" }));
    fireEvent.click(screen.getByRole("button", { name: "More room details" }));
    const field = screen.getByRole("combobox", { name: "Sensitivity limit" }) as HTMLSelectElement;
    expect(field.disabled).toBe(true); expect(field.value).toBe("engineering-only");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveWorkroomBoundary).toHaveBeenCalledWith("WC-TEST", "row", expect.objectContaining({ preserveSensitivity: true, sensitivityCeiling: null })));
  });
  it("offers a real button, not a label", () => {
    const html = markup();
    expect(html).toContain("<button");
    expect(html).toContain("Define this room");
  });

  it("does not open onto a wizard — spec §7.2 forbids blocking behind one", () => {
    // Collapsed by default: a room with gaps stays readable.
    const html = markup();
    expect(html).not.toContain("What does finished look like?");
    expect(html).not.toContain("Not in scope");
  });

  it("renders an existing declaration back so an owner can correct it", () => {
    const html = markup({ outcome: "Shipped", accountablePrincipalRef: "role:owner" });
    // Still collapsed, but the values are carried into state rather than lost.
    expect(html).toContain("Define this room");
  });
});
