import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CoworkerActivityInspectionLink } from "./CoworkerActivityInspectionLink";

describe("CoworkerActivityInspectionLink", () => {
  it("links coworker upgrade blockers to the AI workforce inspection view (BI-FDB25FA6)", () => {
    const html = renderToStaticMarkup(
      <CoworkerActivityInspectionLink surface="coworker.reasoning-loop" />,
    );

    expect(html).toContain('href="/platform/ai/right-now"');
    expect(html).toContain("Inspect AI workforce activity");
  });

  it("does not render for blockers outside the coworker surface (BI-FDB25FA6)", () => {
    const html = renderToStaticMarkup(
      <CoworkerActivityInspectionLink surface="build-studio.phase.build" />,
    );

    expect(html).toBe("");
  });
});
