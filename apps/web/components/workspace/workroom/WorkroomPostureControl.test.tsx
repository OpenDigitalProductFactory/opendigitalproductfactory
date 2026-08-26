import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/workroom-posture", () => ({
  saveWorkroomPosture: vi.fn(),
  saveWorkroomShape: vi.fn(),
  resetWorkroomPosture: vi.fn(),
}));

import { WorkroomPostureControl } from "./WorkroomPostureControl";

// EP-WORK-POSTURE — the guard against the defect this component fixes.
//
// The room displayed a pace and priority it gave the operator NO WAY to change:
// every settable control was per-coworker. These assert the control is genuinely
// interactive, because "renders something" was never the problem — "renders
// something inert" was.

function markup(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    React.createElement(WorkroomPostureControl, {
      roomRowId: "room-1",
      caseKey: "WC-TEST0001",
      currentShape: null,
      currentPace: "balanced",
      currentAuthority: "propose",
      hasDeclaration: false,
      ...overrides,
    } as never),
  );
}

describe("WorkroomPostureControl", () => {
  it("renders a real button for each of the three decisions", () => {
    const html = markup();
    // Buttons, not labels: the failure being guarded is a surface that shows a
    // setting and cannot change it.
    expect(html).toContain("<button");
    expect(html).toContain("Goes outside");
    expect(html).toContain("Pushes");
    expect(html).toContain("Advises only");
    expect(html).toContain("Sign-off");
    expect(html).toContain("Escalation");
  });

  it("marks the option currently in force with aria-pressed", () => {
    const html = markup({ currentPace: "assertive", currentAuthority: "advise" });
    expect(html).toMatch(/aria-pressed="true"/);
    // and something is NOT pressed, so the attribute is meaningful
    expect(html).toMatch(/aria-pressed="false"/);
  });

  it("offers a way back to the default only when this room overrode it", () => {
    expect(markup({ hasDeclaration: false })).not.toContain("go back to the default");
    expect(markup({ hasDeclaration: true })).toContain("go back to the default");
  });

  it("states plainly that a looser authority setting cannot widen permissions", () => {
    // The tighten-only rule is invisible unless said; an operator choosing
    // "Acts alone" deserves to know it may not take effect.
    expect(markup()).toContain("cannot give a coworker more freedom");
  });

  it("uses theme tokens, never hardcoded colour", () => {
    const html = markup();
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(html).not.toMatch(/\btext-(white|black)\b/);
    expect(html).not.toMatch(/\b(bg|text|border)-gray-\d/);
    expect(html).toMatch(/--dpf-/);
  });

  it("shows the selected shape when the room declared one", () => {
    expect(markup({ currentShape: "outward-review" })).toMatch(/aria-pressed="true"/);
  });
});
