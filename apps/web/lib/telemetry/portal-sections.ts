// Server-only: the top-level page segments of the portal, derived from the
// generated route manifest so a new section is allowlisted without an edit
// here. Anything else is reported under "other" (BI-BD0B0DCC).

import routeManifest from "@/lib/ea/route-manifest.json";

let cached: ReadonlySet<string> | null = null;

export function portalSections(): ReadonlySet<string> {
  if (cached) return cached;
  const sections = new Set<string>(["root"]);
  for (const route of (routeManifest as { routes: Array<{ routePath: string; kind: string }> }).routes) {
    if (route.kind !== "page") continue;
    const first = route.routePath.split("/").filter(Boolean)[0];
    if (first && !first.startsWith("[") && !first.startsWith("(")) sections.add(first.toLowerCase());
  }
  cached = sections;
  return cached;
}
