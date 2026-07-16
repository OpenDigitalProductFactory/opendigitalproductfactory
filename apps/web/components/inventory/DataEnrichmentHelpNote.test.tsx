import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DataEnrichmentHelpNote } from "./DataEnrichmentHelpNote";

describe("DataEnrichmentHelpNote", () => {
  const html = renderToStaticMarkup(<DataEnrichmentHelpNote />);

  it("surfaces the question users asked on Discovery Operations", () => {
    expect(html).toContain("Where do I enable Data Enrichment?");
  });

  it("points to the real enablement surface (Tools & Services)", () => {
    expect(html).toContain('href="/platform/tools/services"');
    expect(html).toContain("Tools &amp; Services");
  });

  it("states the role-based visibility: only the Admin role can enable it", () => {
    expect(html).toContain("Admin role (HR-000)");
    expect(html).toMatch(/Other roles \(HR-100.HR-500\) do not see the enable controls/);
  });

  it("gives non-admins the admin-handoff step", () => {
    expect(html).toContain("Not an admin?");
    expect(html).toContain("Ask your");
    expect(html).toContain("platform admin (HR-000 / CDIO)");
  });
});
