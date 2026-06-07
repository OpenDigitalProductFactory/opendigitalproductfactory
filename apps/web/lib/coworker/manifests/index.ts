// Pseudo-User Contract (spec §6.1) — registry of all ScreenManifests in
// the platform. Pages that want their surface to be coworker-drivable
// import + re-export their manifest here. The CI lint
// (`screen-manifest.test.ts`) iterates ALL_MANIFESTS to enforce the
// invariants.
//
// Empty in Phase 1 — the first consumer lands in BI-6C9CC0EC (Build
// Studio manifest registration). Until then the lint machinery is
// exercised via test fixtures.
//
// BI-D9487754 / EP-COWORKER-INTERACTIVITY.

import { matchesRoute } from "../screen-manifest-registry";
import type { ScreenManifest } from "../screen-manifest-types";

export const ALL_MANIFESTS: ScreenManifest[] = [];

/** Server-side resolution: find the manifest whose routePattern matches
 *  the given actualRoute. Reuses the registry's matchesRoute so the
 *  client runtime and server dispatch path can never disagree about
 *  which manifest is active.
 *
 *  Returns undefined when no manifest matches. Used by the
 *  screen_dispatch_action handler (BI-0F9C291C part 4) to resolve an
 *  envelope's manifestActionId back to the underlying MCP tool. */
export function findManifestForRoute(actualRoute: string): ScreenManifest | undefined {
  for (const m of ALL_MANIFESTS) {
    if (matchesRoute(actualRoute, m.routePattern)) return m;
  }
  return undefined;
}
