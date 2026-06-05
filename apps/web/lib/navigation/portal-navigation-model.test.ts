import { describe, expect, it } from "vitest";

import { PLATFORM_FAMILIES } from "@/components/platform/platform-nav";
import { getShellNavSections } from "@/lib/govern/permissions";

import {
  PORTAL_NAV_ROUTES,
  getPrimaryNavEntries,
  getRouteNavRecord,
  getSectionNavEntries,
} from "./portal-navigation-model";

const adminUser = { platformRole: "HR-000", isSuperuser: false };

describe("portal navigation model", () => {
  it("has one unique route record per path", () => {
    const paths = PORTAL_NAV_ROUTES.map((route) => route.path);

    expect(new Set(paths).size).toBe(paths.length);
  });

  it("keeps section navigation inside its parent domain", () => {
    for (const route of PORTAL_NAV_ROUTES) {
      for (const item of route.sectionSiblings ?? []) {
        expect(item.startsWith(route.parentPath)).toBe(true);
      }
    }
  });

  it("does not expose Admin as a Platform family sibling", () => {
    const platformTabs = getSectionNavEntries("/platform").map((entry) => entry.path);

    expect(platformTabs).not.toContain("/admin");
  });

  it("keeps worker and operator primary entries separately addressable", () => {
    const workerKeys = getPrimaryNavEntries("worker").map((entry) => entry.key);
    const operatorKeys = getPrimaryNavEntries("operator").map((entry) => entry.key);

    expect(workerKeys).toContain("workspace");
    expect(operatorKeys).toContain("platform");
    expect(workerKeys).not.toContain("admin");
  });

  it("classifies legacy redirect destinations as redirects, not primary nav", () => {
    expect(getRouteNavRecord("/admin/storefront")?.destinationKind).toBe(
      "legacy-redirect",
    );
    expect(getPrimaryNavEntries("operator").map((entry) => entry.path)).not.toContain(
      "/admin/storefront",
    );
  });

  it("covers current shell navigation entries without changing visible routes", () => {
    const shellHrefs = getShellNavSections(adminUser)
      .flatMap((section) => section.items)
      .map((item) => item.href);

    expect(shellHrefs).toContain("/platform");
    expect(shellHrefs).toContain("/admin");

    for (const href of shellHrefs) {
      expect(getRouteNavRecord(href), href).toBeDefined();
    }
  });

  it("covers current platform family entries without keeping Admin inside Platform", () => {
    const platformFamilyHrefs = PLATFORM_FAMILIES.flatMap((family) => [
      family.href,
      ...family.subItems.map((item) => item.href),
    ]);

    expect(platformFamilyHrefs).toContain("/admin");
    expect(getSectionNavEntries("/platform").map((entry) => entry.path)).not.toContain(
      "/admin",
    );

    for (const href of platformFamilyHrefs) {
      expect(getRouteNavRecord(href), href).toBeDefined();
    }
  });
});
