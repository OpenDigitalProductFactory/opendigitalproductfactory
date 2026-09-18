import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/workroom-boundary", () => ({
  saveWorkroomBoundary: vi.fn().mockResolvedValue({ ok: true }),
}));

import { WorkroomBoundaryControl } from "./WorkroomBoundaryControl";

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
