/**
 * BI-DE67A3EC — resolving a dynamic route to a concrete path for the sweep.
 *
 * The UX route sweep could only ever measure routes with no `[param]` segment,
 * because nothing produced an id to substitute. That excluded 87 of 325 routes,
 * 53 of them owner-facing — every DETAIL surface, which is exactly where a word
 * budget, a field count or an axe violation matters most. A gate that measures
 * only list pages reports a green it has not earned.
 *
 * The fixture mints deterministic rows and publishes their paths here; the sweep
 * reads them. Kept in its own module rather than inside the runner so the
 * resolution rule is unit-testable without a browser, and so the runner stays
 * under its size ceiling.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { SWEEP_ROUTE_PARAMS_REL } from "../lib/ux-budget/route-shells";

export type SweepRouteParams = Readonly<Record<string, string>>;

/**
 * Paths the sweep fixture minted for dynamic routes.
 *
 * An absent or unreadable file yields no params rather than throwing. That is
 * only a problem if an ELIGIBLE dynamic route then goes unresolved, which
 * `resolveSweepPath` raises — this read does not guess at intent.
 */
export function loadRouteParams(root: string): SweepRouteParams {
  const path = join(root, SWEEP_ROUTE_PARAMS_REL);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { routes?: Record<string, string> };
    return parsed.routes ?? {};
  } catch {
    return {};
  }
}

/**
 * The concrete path to navigate for a route.
 *
 * A static route is its own path. A dynamic one uses the path the fixture
 * published. If a dynamic route is eligible but unresolved that is an ERROR, not
 * a fallback: navigating the literal `[caseKey]` would 404 — or worse, match a
 * catch-all — and freeze a measurement for a page that does not exist. An
 * unresolvable route must stop the run rather than quietly become a number.
 */
export function resolveSweepPath(routePath: string, params: SweepRouteParams): string {
  if (!routePath.includes("[")) return routePath;
  const resolved = params[routePath];
  if (!resolved) {
    throw new Error(
      `dynamic route ${routePath} is sweep-eligible but the fixture published no path for it — `
        + "run ux:sweep-fixture, or remove the route from SWEEP_RESOLVABLE_DYNAMIC_ROUTES",
    );
  }
  return resolved;
}
