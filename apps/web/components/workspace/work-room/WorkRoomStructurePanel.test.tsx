import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { resolveWorkRoomStructure } from "@/lib/work-management/room-structure";

import { WorkRoomStructurePanel } from "./WorkRoomStructurePanel";

describe("WorkRoomStructurePanel", () => {
  it("renders nothing when the subject has no structure", () => {
    const html = renderToStaticMarkup(<WorkRoomStructurePanel structure={null} />);
    expect(html).toBe("");
  });

  it("surfaces the value stream, lifecycle stage/state, and advancement gates", () => {
    const structure = resolveWorkRoomStructure({ kind: "opportunity", stage: "qualification" });
    const html = renderToStaticMarkup(<WorkRoomStructurePanel structure={structure} />);
    expect(html).toContain("Value stream");
    expect(html).toContain("Lifecycle");
    // Labels may carry "&" which HTML-escapes; assert on a special-char-free token.
    const safe = (label: string) => label.split(/\s*&\s*/)[0];
    expect(html).toContain(safe(structure!.valueStream!.label));
    expect(html).toContain(safe(structure!.lifecycle!.stageLabel));
    expect(html).toContain("Advancement gates");
    // Every derived gate target is named in the panel.
    for (const gate of structure!.lifecycle!.nextGates) {
      expect(html).toContain(safe(gate.toStageLabel));
    }
  });
});
