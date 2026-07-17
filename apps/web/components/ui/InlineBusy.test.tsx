import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { InlineBusy } from "./InlineBusy";

describe("InlineBusy", () => {
  it("announces the pending label in a single live status region", () => {
    const html = renderToStaticMarkup(<InlineBusy label="Saving…" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Saving…");
    // Exactly one status region — the composed spinner must be presentational,
    // not a second announced region.
    expect(html.match(/role="status"/g)?.length).toBe(1);
  });

  it("includes a spinning (decorative) ring", () => {
    const html = renderToStaticMarkup(<InlineBusy label="Working…" />);
    expect(html).toContain("dpf-spin");
    expect(html).toContain('aria-hidden="true"');
  });
});
