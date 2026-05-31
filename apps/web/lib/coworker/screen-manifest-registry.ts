// Pseudo-User Contract (spec §6.1) — runtime ScreenManifest registry.
//
// Process-local Map keyed by surfaceId. The React hook
// (use-screen-manifest.ts) registers a manifest at component mount and
// removes it at unmount. The registry also publishes a snapshot to
// `window.__dpf_screen_registry__` for chat-handler / debugger discovery
// (no-op outside a browser context, e.g. during SSR or unit tests run in
// Node mode).
//
// BI-D9487754 / EP-COWORKER-INTERACTIVITY.

import type { ScreenManifest } from "./screen-manifest-types";

// Module-local source of truth. The window publish below is a mirror,
// not the canonical store — tests and server code talk to this Map.
const _activeManifests = new Map<string, ScreenManifest>();

/** Augment globalThis so TypeScript accepts the window publish. The actual
 *  field is set at runtime; the typing is just for our own consumers. */
declare global {
  interface Window {
    __dpf_screen_registry__?: {
      manifests: ScreenManifest[];
    };
  }
}

const REGISTRY_CHANGE_EVENT = "coworker-screen-registry-changed";

export function registerManifest(manifest: ScreenManifest): void {
  _activeManifests.set(manifest.surfaceId, manifest);
  publishToWindow();
  dispatchChangeEvent();
}

export function unregisterManifest(surfaceId: string): void {
  _activeManifests.delete(surfaceId);
  publishToWindow();
  dispatchChangeEvent();
}

/** Resolve the active manifest for a route. The first matching pattern
 *  wins; if multiple manifests match the same route, that's a manifest
 *  authoring bug surfaced by the lint MANIFEST-000 invariant (unique
 *  surfaceId, but multiple manifests can claim the same pattern — see
 *  follow-on note in BI-DF6079E9). */
export function getActiveManifest(actualRoute: string): ScreenManifest | undefined {
  for (const m of _activeManifests.values()) {
    if (matchesRoute(actualRoute, m.routePattern)) return m;
  }
  return undefined;
}

export function listActiveManifests(): ScreenManifest[] {
  return Array.from(_activeManifests.values());
}

function publishToWindow(): void {
  if (typeof globalThis === "undefined") return;
  const g = globalThis as typeof globalThis & {
    __dpf_screen_registry__?: { manifests: ScreenManifest[] };
  };
  g.__dpf_screen_registry__ = {
    manifests: Array.from(_activeManifests.values()),
  };
}

function dispatchChangeEvent(): void {
  if (typeof window === "undefined") return;
  if (typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent(REGISTRY_CHANGE_EVENT));
}

/** Simple route pattern matcher: `:param` segments accept any non-empty
 *  value. Used by getActiveManifest. Not a full router — pages with
 *  complex matching needs may add a more sophisticated matcher in
 *  BI-6C9CC0EC (Build Studio manifest registration) without changing
 *  this signature. */
function matchesRoute(actualRoute: string, pattern: string): boolean {
  const stripTrailing = (s: string) => (s.endsWith("/") && s.length > 1 ? s.slice(0, -1) : s);
  const patternParts = stripTrailing(pattern).split("/");
  const actualParts = stripTrailing(actualRoute).split("/");
  if (patternParts.length !== actualParts.length) return false;
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i];
    const a = actualParts[i];
    if (p === undefined || a === undefined) return false;
    if (p.startsWith(":")) {
      if (a.length === 0) return false;
      continue;
    }
    if (p !== a) return false;
  }
  return true;
}

/** Test-only registry reset. Module-private state would leak between
 *  tests without this; exported with the underscore prefix to mark it
 *  as not-for-production-consumers. */
export function _resetRegistry(): void {
  _activeManifests.clear();
  publishToWindow();
}
