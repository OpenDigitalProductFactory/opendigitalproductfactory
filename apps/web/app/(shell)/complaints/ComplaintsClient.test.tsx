import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ComplaintsClient } from "./ComplaintsClient";

describe("ComplaintsClient (report-kit migration)", () => {
  const html = renderToStaticMarkup(<ComplaintsClient />);

  it("renders the demo rows through DataTable", () => {
    expect(html).toContain("Sarah Chen");
    expect(html).toContain("Lisa Patel");
  });

  it("renders status/severity via token-backed StatusBadge (no raw hex)", () => {
    // critical severity → danger intent; investigating status → accent intent
    expect(html).toContain('data-intent="danger"');
    expect(html).toContain('data-intent="accent"');
    expect(html).toMatch(/var\(--dpf-/);
    // the old raw-hex color maps must be gone from the rendered output
    expect(html).not.toMatch(/#(22c55e|ef4444|eab308|f97316|3b82f6|a855f7|6b7280)/i);
  });

  it("renders the FilterBar status facet", () => {
    expect(html).toContain("Status");
    expect(html).toContain("Investigating");
  });
});
