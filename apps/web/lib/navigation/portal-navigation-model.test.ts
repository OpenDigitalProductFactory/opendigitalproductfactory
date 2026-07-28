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

  it("keeps Work Cases as a Workspace section with detail as drill-down depth", () => {
    expect(getSectionNavEntries("/workspace").map((entry) => entry.path)).toContain(
      "/workspace/my-queue",
    );
    expect(getRouteNavRecord("/workspace/my-queue")?.domain).toBe("workspace");
    expect(getRouteNavRecord("/workspace/cases/[caseKey]")?.destinationKind).toBe("detail");
  });

  it("models Operations and Performance as distinct main-rail domain homes", () => {
    const operations = getRouteNavRecord("/workspace");
    const performance = getRouteNavRecord("/performance");

    expect(operations).toMatchObject({
      label: "Operations",
      domain: "workspace",
      destinationKind: "domain-home",
    });
    expect(performance).toMatchObject({
      label: "Performance",
      domain: "performance",
      destinationKind: "domain-home",
      capabilityKey: "view_business_performance",
    });
    expect(operations?.shellNav?.sectionKey).toBe("workspace");
    expect(performance?.shellNav?.sectionKey).toBe("workspace");
  });

  it("keeps Performance out of the Operations section-level queue navigation", () => {
    const operationsSections = getSectionNavEntries("/workspace").map((entry) => entry.path);

    expect(operationsSections).toContain("/workspace/inbox");
    expect(operationsSections).toContain("/workspace/my-queue");
    expect(operationsSections).not.toContain("/performance");
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

    // EP-NAV-COHERENCE keystone: the "Core Admin" family was removed, so the
    // platform tab component no longer links out to /admin at all (it was a
    // cross-context teleport). Admin is reached from the persistent rail instead.
    expect(platformFamilyHrefs).not.toContain("/admin");
    expect(getSectionNavEntries("/platform").map((entry) => entry.path)).not.toContain(
      "/admin",
    );

    for (const href of platformFamilyHrefs) {
      expect(getRouteNavRecord(href), href).toBeDefined();
    }
  });

  it("groups the Delivery home and Build Studio under a Delivery section (BI-ARCH-DELIVERY-IA)", () => {
    const delivery = getRouteNavRecord("/delivery");
    expect(delivery?.domain).toBe("delivery");
    expect(delivery?.shellNav?.sectionKey).toBe("delivery");

    const sections = getShellNavSections(adminUser);
    const deliverySection = sections.find((section) => section.key === "delivery");
    expect(deliverySection, "Delivery shell section should exist").toBeDefined();

    const deliveryHrefs = deliverySection?.items.map((item) => item.href) ?? [];
    expect(deliveryHrefs).toContain("/delivery");
    expect(deliveryHrefs).toContain("/build");

    // Build Studio's work surface moved out of the Platform rail section into
    // Delivery (its model/provider config stays under Platform at
    // /platform/ai/build-studio).
    const platformSection = sections.find((section) => section.key === "platform");
    expect(platformSection?.items.map((item) => item.href) ?? []).not.toContain("/build");
  });
});
