import { describe, expect, it } from "vitest";

import { ADMIN_FAMILIES } from "./admin-nav";
import { adminPageLocation, adminPageLocationLabel } from "./admin-location";
import { getAreaSetupEntries } from "./portal-navigation-model";
import { AREA_VIEW_LABELS, PORTAL_SHELL_SECTIONS } from "./portal-shell-sections";

// BI-DB506554: messages named "Admin › Platform Development › MCP", which no
// menu shows. A location an operator is told to follow is read from the nav
// model, so it cannot drift from the menu again.
describe("adminPageLocation", () => {
  it("walks from a rail area to the admin tab that holds the page", () => {
    expect(adminPageLocation("/admin/platform-development")).toEqual([
      "Run the platform",
      "Setup",
      "Admin",
      "Contributing & GitHub",
    ]);
    expect(adminPageLocationLabel("/admin/platform-development")).toBe(
      "Run the platform › Setup › Admin › Contributing & GitHub",
    );
  });

  it("names only steps the navigation actually shows", () => {
    for (const family of ADMIN_FAMILIES) {
      const [area, view, admin, tab] = adminPageLocation(family.href);
      const section = PORTAL_SHELL_SECTIONS.find((candidate) => candidate.label === area);
      expect(section, `${area} is a rail area`).toBeDefined();
      expect(view).toBe(AREA_VIEW_LABELS.setup);
      expect(getAreaSetupEntries(section!.key).map((entry) => entry.label)).toContain(admin);
      // AdminTabNav renders one tab per family, labelled with the family label.
      expect(tab).toBe(family.label);
    }
  });

  it("refuses a page outside Admin rather than inventing a path", () => {
    expect(() => adminPageLocation("/ops/self-upgrade")).toThrow(/not an Admin page/);
  });
});
