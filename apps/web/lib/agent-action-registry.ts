// apps/web/lib/agent-action-registry.ts
import type { PageAction, PageActionManifest } from "@/lib/agent-action-types";
import { can, type UserContext } from "@/lib/permissions";
import { employeeActions } from "@/app/(shell)/employee/actions/manifest";

// Import manifests as they are created — each page adds its manifest here
const manifests: PageActionManifest[] = [
  employeeActions,
];

/**
 * Returns page actions available for a route, filtered by user capability.
 * Uses longest-prefix matching consistent with resolveRouteContext().
 * The match requires exact route or route + "/" prefix to prevent
 * "/employee-settings" from matching "/employee".
 */
export function getActionsForRoute(route: string, userContext: UserContext): PageAction[] {
  const match = manifests
    .filter((m) => route === m.route || route.startsWith(m.route + "/"))
    .sort((a, b) => b.route.length - a.route.length)[0];
  if (!match) return [];
  return match.actions.filter(
    (a) => a.requiredCapability === null || can(userContext, a.requiredCapability),
  );
}

/** Register a manifest at import time */
export function registerManifest(manifest: PageActionManifest): void {
  manifests.push(manifest);
}
