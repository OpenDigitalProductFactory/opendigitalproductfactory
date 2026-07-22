// Shared route-classification logic (BI-8C0F219A).
//
// Cross-references every Next.js App Router page route against the canonical
// portal navigation model (apps/web/lib/navigation/portal-navigation-model.ts),
// which is the single source of truth for a route's audience + destination-kind.
// A route is "classified" when it is represented in that model, is a dynamic
// detail route, or is a legacy redirect shim; anything else is "unclassified" —
// reachable by URL but invisible to the canonical navigation/IA model.
//
// Pure/deterministic; used by the manifest generator, the CI ratchet guard, and
// their tests.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const APP_DIR = "apps/web/app";
export const NAV_MODEL = "apps/web/lib/navigation/portal-navigation-model.ts";

export function walkPageRoutes(appDir = APP_DIR) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "page.tsx" || name === "page.ts") out.push(p.replace(/\\/g, "/"));
    }
  };
  walk(appDir);
  return out.sort();
}

export function routePath(file, appDir = APP_DIR) {
  const rel = file.slice(appDir.length).replace(/\/page\.tsx?$/, "");
  const segs = rel.split("/").filter((s) => s && !/^\(.*\)$/.test(s));
  return "/" + segs.join("/");
}

export function routeGroup(file, appDir = APP_DIR) {
  const m = file.slice(appDir.length).match(/^\/(\([^)]+\))\//);
  return m ? m[1] : "(root)";
}

export const isDynamicRoute = (route) => /\[.*\]/.test(route);

export function loadNavModelPaths(modelFile = NAV_MODEL) {
  const src = readFileSync(modelFile, "utf8");
  return new Set([...src.matchAll(/\bpath:\s*"([^"]+)"/g)].map((m) => m[1]));
}

/** Pure classifier — decoupled from the filesystem so it is unit-testable. */
export function classify({ route, dynamic, isRedirect, navModelPaths }) {
  if (navModelPaths.has(route)) return "nav-model";
  if (dynamic) return "detail";
  if (isRedirect) return "legacy-redirect";
  return "unclassified";
}

export function classifyFile(file, { navModelPaths, appDir = APP_DIR } = {}) {
  const route = routePath(file, appDir);
  const group = routeGroup(file, appDir);
  const dynamic = isDynamicRoute(route);
  let body = "";
  try {
    body = readFileSync(file, "utf8");
  } catch {
    // Unreadable file — treated as non-redirect below.
  }
  const isRedirect = /\b(permanentRedirect|redirect)\s*\(/.test(body) && body.length < 4000;
  const classification = classify({ route, dynamic, isRedirect, navModelPaths });
  return { route, group, dynamic, inNavModel: navModelPaths.has(route), classification };
}

export function buildRouteManifest({ appDir = APP_DIR, modelFile = NAV_MODEL } = {}) {
  const navModelPaths = loadNavModelPaths(modelFile);
  return walkPageRoutes(appDir).map((f) => classifyFile(f, { navModelPaths, appDir }));
}

/** Distinct route paths that are not represented in the canonical model. */
export function unclassifiedRoutes(manifest) {
  return [
    ...new Set(
      manifest.filter((r) => r.classification === "unclassified").map((r) => r.route),
    ),
  ].sort();
}
