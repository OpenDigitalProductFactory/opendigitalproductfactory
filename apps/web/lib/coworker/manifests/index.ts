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

import type { ScreenManifest } from "../screen-manifest-types";

export const ALL_MANIFESTS: ScreenManifest[] = [];
