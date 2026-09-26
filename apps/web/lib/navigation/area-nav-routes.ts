// EP-2FB6C0CC (spec 2026-08-14-portfolio-shaped-information-architecture-design.md
// §9.3-9.4): nav records for the workroom-shaped areas — each area's home, the
// platform upkeep pages that moved out of /ops's tab row, and the settings pages
// listed in each area's Setup view. Spread into PORTAL_NAV_ROUTES like
// MAILROOM_NAV_ROUTES, so the nav model stays the single source.

import type { CapabilityKey } from "@/lib/govern/permissions";

import type { PortalDomain, PortalNavRecord } from "./portal-navigation-model";
import { AREA_SECTIONS, type PortalShellSectionKey } from "./portal-shell-sections";

function setupRoute(
  key: string,
  label: string,
  path: string,
  parentPath: string,
  domain: PortalDomain,
  capabilityKey: CapabilityKey,
  setupFor: PortalShellSectionKey,
): PortalNavRecord {
  return { key, label, path, parentPath, domain, audienceModes: ["operator"], destinationKind: "settings", capabilityKey, setupFor };
}

export const AREA_UPKEEP_AND_SETUP_ROUTES: readonly PortalNavRecord[] = [
  // EP-2FB6C0CC (BI-811C588E): platform upkeep. Routes stay under /ops for
  // bookmarks; the platform domain and parent put them in Run the platform.
  ...([
    ["platform-updates-self-upgrade", "Self-upgrade", "/ops/self-upgrade"],
    ["platform-updates-patches", "Patches", "/ops/patches"],
    ["platform-updates-installation", "Installation", "/ops/installation"],
    ["platform-updates-dev-loop", "Dev loop", "/ops/dev-loop"],
    ["platform-updates-teardown", "Teardown", "/ops/teardown"],
    ["platform-updates-security", "Security", "/ops/security"],
    ["platform-updates-change-lanes", "Change lanes", "/platform/development/change-lanes"],
  ] as const).map(
    ([key, label, path]): PortalNavRecord => ({ key, label, path, parentPath: "/platform", domain: "platform", audienceModes: ["operator"], destinationKind: "section-page", capabilityKey: "view_operations" }),
  ),
  // EP-2FB6C0CC (spec §9.4): settings homed in the area whose runtime reads them.
  setupRoute("storefront-settings", "Storefront settings", "/storefront/settings", "/storefront", "business", "view_storefront", "business"),
  setupRoute("storefront-settings-business", "Business profile", "/storefront/settings/business", "/storefront/settings", "business", "view_storefront", "business"),
  setupRoute("storefront-settings-operations", "Business hours", "/storefront/settings/operations", "/storefront/settings", "business", "view_storefront", "business"),
  setupRoute("admin-branding", "Branding", "/admin/branding", "/admin", "admin", "view_admin", "business"),
  setupRoute("finance-settings", "Finance settings", "/finance/settings", "/finance", "business", "view_finance", "business"),
  setupRoute("admin-storefront-preset", "Storefront preset", "/admin/storefront/preset", "/admin", "admin", "view_admin", "business"),
  setupRoute("platform-ai-browser-sessions-setup", "Browser setup", "/platform/ai/browser-sessions/setup", "/platform/ai", "platform", "view_platform", "team"),
  setupRoute("admin-reference-data", "Work locations", "/admin/reference-data", "/admin", "admin", "view_admin", "team"),
  setupRoute("admin-platform-development", "Contributing & GitHub", "/admin/platform-development", "/admin", "admin", "view_admin", "delivery"),
  setupRoute("admin-build-studio-stall-thresholds", "Build stall thresholds", "/admin/build-studio/stall-thresholds", "/admin", "admin", "view_admin", "delivery"),
  setupRoute("admin-settings", "Sign-in, email and storage", "/admin/settings", "/admin", "admin", "view_admin", "platform"),
  setupRoute("admin-backups", "Backups", "/admin/backups", "/admin", "admin", "view_admin", "platform"),
  setupRoute("admin-scheduled-jobs", "Scheduled jobs", "/admin/scheduled-jobs", "/admin", "admin", "view_admin", "platform"),
  setupRoute("admin-diagnostics", "Diagnostics", "/admin/diagnostics", "/admin", "admin", "view_admin", "platform"),
  setupRoute("admin-data-stewardship", "Data stewardship", "/admin/data-stewardship", "/admin", "admin", "view_admin", "platform"),
];

export const AREA_HOME_ROUTES: readonly PortalNavRecord[] = [
  ...AREA_SECTIONS.map(
    (section): PortalNavRecord => ({
      key: `area-${section.key}`,
      label: section.label,
      path: `/area/${section.key}`,
      parentPath: `/area/${section.key}`,
      domain: "workspace",
      audienceModes: ["worker", "operator"],
      destinationKind: "domain-home",
      capabilityKey: null,
    }),
  ),
];
