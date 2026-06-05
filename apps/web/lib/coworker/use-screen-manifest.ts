"use client";

// Pseudo-User Contract (spec §6.1) — React hook that publishes a page's
// ScreenManifest to the runtime registry for the lifetime of the
// component that calls it.
//
// Usage (in a page or top-level layout):
//
//   "use client";
//   import { useScreenManifest } from "@/lib/coworker/use-screen-manifest";
//   import { BUILD_STUDIO_MANIFEST } from "./manifest";
//
//   export function BuildStudioShell() {
//     useScreenManifest(BUILD_STUDIO_MANIFEST);
//     // ...
//   }
//
// The hook is intentionally trivial — register-on-mount, unregister-on-
// unmount. Any logic that needs to react to the registry change subscribes
// to the `coworker-screen-registry-changed` window event (dispatched by
// the registry itself).
//
// BI-D9487754 / EP-COWORKER-INTERACTIVITY.

import { useEffect } from "react";

import {
  registerManifest,
  unregisterManifest,
} from "./screen-manifest-registry";
import type { ScreenManifest } from "./screen-manifest-types";

export function useScreenManifest(manifest: ScreenManifest): void {
  useEffect(() => {
    registerManifest(manifest);
    return () => unregisterManifest(manifest.surfaceId);
  }, [manifest]);
}
