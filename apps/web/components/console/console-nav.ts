// apps/web/components/console/console-nav.ts
//
// One operator console (EP-NAV-COHERENCE P1 / BI-CB07C8BA). Platform and Admin used to
// render two different secondary-nav tab rows, so crossing /platform <-> /admin swapped
// the whole context (the founder's complaint #1; the keystone removed the teleport tab,
// this removes the residual context swap). CONSOLE_FAMILIES composes the Platform
// families with a single "Administration" family folding the Admin areas; ConsoleTabNav
// renders it for BOTH trees, so crossing the boundary changes only the active family.
//
// Composes the existing PLATFORM_FAMILIES + ADMIN_FAMILIES data (no second copy); those
// modules stay the source of truth (and remain registered in the navigation surface).

import { PLATFORM_FAMILIES } from "@/components/platform/platform-nav";
import { ADMIN_FAMILIES } from "@/components/admin/admin-nav";

export type ConsoleFamily = {
  key: string;
  label: string;
  href: string;
  description: string;
  matchPrefixes: string[];
  subItems: Array<{ label: string; href: string }>;
};

export const CONSOLE_FAMILIES: ConsoleFamily[] = [
  ...PLATFORM_FAMILIES,
  {
    key: "administration",
    label: "Administration",
    href: "/admin",
    description:
      "User access, organization identity, configuration, and specialist platform controls.",
    matchPrefixes: ["/admin"],
    subItems: ADMIN_FAMILIES.flatMap((family) => family.subItems),
  },
];

/** Resolve the active console family for a path. Admin paths -> Administration; the
 *  platform root -> Overview; otherwise the most specific platform family by prefix
 *  (Overview is the fallback, matching the prior getPlatformFamily behavior). */
export function getConsoleFamily(pathname: string): ConsoleFamily {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return CONSOLE_FAMILIES.find((family) => family.key === "administration")!;
  }
  if (pathname === "/platform") {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return CONSOLE_FAMILIES[0]!; // Overview
  }
  return (
    CONSOLE_FAMILIES.find(
      (family) =>
        family.key !== "overview" &&
        family.key !== "administration" &&
        family.matchPrefixes.some((prefix) => pathname.startsWith(prefix)),
    ) ?? CONSOLE_FAMILIES[0]!
  );
}
