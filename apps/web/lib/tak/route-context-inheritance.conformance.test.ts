import { describe, expect, it } from "vitest";
import { resolveRouteContext } from "./route-context-map";
import routeManifest from "@/lib/ea/route-manifest.json";

/**
 * Coworker page-perception inheritance guard.
 *
 * Source of truth: docs/superpowers/specs/2026-08-05-coworker-page-perception-
 * context-contract-design.md §6.2 (exact-route resolution, NO data inheritance)
 * and §8 (a child route must never inherit a sibling's page context). Tracked by
 * BI-5457E216 under EP-8C706944. This is the mechanical guard slice, buildable
 * now against the central registry before the full page-owned-contract rebuild
 * (Option B) lands.
 *
 * THE BUG CLASS THIS PREVENTS (BI-FD7E4D72, and 3 recurrences to date):
 * both coworker context injectors resolve "what page am I on" by LONGEST-PREFIX
 * match. Some entries assert a *specific page identity* — the "/ops" entry's
 * domainContext says the page "shows the delivery backlog". A new child route
 * under such a parent that has no entry of its own silently inherits that
 * identity, so the coworker on /ops/self-upgrade confidently described the
 * delivery backlog. The default fallback never fires because a (wrong) match was
 * found — nothing looks broken at runtime.
 *
 * This anchors on resolveRouteContext (route-context-map.ts, the domain-context
 * injector) — its ROUTE_CONTEXT_MAP + resolveRouteContext are already exported,
 * and the same longest-prefix mislabel exists in the PAGE DATA provider registry
 * (route-context.ts). The guard scopes to IDENTITY-ASSERTING parents (whose
 * domainContext names a specific page that would be wrong for a sibling), NOT
 * all inheritance: broad-domain entries (finance) or sub-route-aware providers
 * (compliance) legitimately serve their children and are out of scope. Adding a
 * newly-identified greedy parent is a one-line change below.
 */

// Entries whose domainContext asserts a specific page identity, so a child that
// inherits it is actively MISLABELED (not merely under-briefed). Keep this tight
// — only add a prefix once its entry is confirmed to assert an identity that
// contradicts its sub-routes.
const IDENTITY_ASSERTING_PARENTS: readonly string[] = [
  // ROUTE_CONTEXT_MAP["/ops"].domainContext → "shows the delivery backlog"
  // (proven 3× offender via longest-prefix fallthrough).
  "/ops",
];

// Children that inherit an identity-asserting parent and have been reviewed.
//   OK             — inheriting the parent's identity is genuinely correct here.
//   NEEDS-PROVIDER — known mislabel debt: this route should get its own entry.
//                    Tracked under BI-5457E216 / the page-perception epic. Listed
//                    here so the guard stays green while blocking NEW drift, and
//                    so the debt is counted and visible rather than silent.
const ACKNOWLEDGED_IDENTITY_INHERITORS: Record<string, string> = {
  // NEEDS-PROVIDER: the /ops/* orphans that inherit the "delivery backlog"
  // identity today. Design doc §3 / §7 Phase 1 calls for carving each out like
  // /ops/dev-loop and /ops/self-upgrade already were. Until then, known debt.
  "/ops/changes": "NEEDS-PROVIDER: inherits Operations/backlog identity; needs own entry (BI-5457E216)",
  "/ops/demand": "NEEDS-PROVIDER: inherits Operations/backlog identity; needs own entry (BI-5457E216)",
  "/ops/health": "NEEDS-PROVIDER: inherits Operations/backlog identity; needs own entry (BI-5457E216)",
  "/ops/improvements": "NEEDS-PROVIDER: inherits Operations/backlog identity; needs own entry (BI-5457E216)",
  "/ops/journeys": "NEEDS-PROVIDER: inherits Operations/backlog identity; needs own entry (BI-5457E216)",
  "/ops/patches": "NEEDS-PROVIDER: inherits Operations/backlog identity; needs own entry (BI-5457E216)",
  "/ops/promotions": "NEEDS-PROVIDER: inherits Operations/backlog identity; needs own entry (BI-5457E216)",
  "/ops/security": "NEEDS-PROVIDER: inherits Operations/backlog identity; needs own entry (BI-5457E216)",
};

type ManifestRow = {
  routePath: string;
  kind: string;
  file?: string;
  dynamicParams?: string[];
};

/**
 * Static shell page routes: the pages a coworker panel renders on. Dynamic
 * detail routes ([id]) are excluded — they legitimately share their parent
 * entity's context, so they are not the mislabel class this guard targets.
 */
function shellStaticPageRoutes(): string[] {
  const rows = (routeManifest as { routes: ManifestRow[] }).routes;
  return rows
    .filter(
      (r) =>
        r.kind === "page" &&
        (r.file ?? "").includes("app/(shell)/") &&
        (r.dynamicParams ?? []).length === 0,
    )
    .map((r) => r.routePath);
}

/** The route-context entry a route resolves to (longest-prefix match). */
function resolvedPrefix(route: string): string {
  return resolveRouteContext(route).routePrefix;
}

describe("coworker route-context inheritance guard", () => {
  const routes = shellStaticPageRoutes();

  it("has a non-empty route manifest to check against", () => {
    // Guards the guard: if the manifest ever fails to load, the coverage checks
    // below would vacuously pass. Fail loudly instead.
    expect(routes.length).toBeGreaterThan(50);
  });

  it("every child of an identity-asserting parent is enrolled or explicitly acknowledged", () => {
    const violations: string[] = [];

    for (const route of routes) {
      const prefix = resolvedPrefix(route);
      if (route === prefix) continue; // has its own entry — exact match, fine
      if (!IDENTITY_ASSERTING_PARENTS.includes(prefix)) continue; // broad/sub-route-aware or the default fallback — out of scope
      if (route in ACKNOWLEDGED_IDENTITY_INHERITORS) continue; // reviewed
      violations.push(
        `${route} silently inherits ${prefix}'s page identity (a mislabel). ` +
          `Give it its own entry in ROUTE_CONTEXT_MAP (route-context-map.ts) — ` +
          `and, for the PAGE DATA injector, a provider in PAGE_CONTEXT_PROVIDERS ` +
          `(route-context.ts) — or add it to ACKNOWLEDGED_IDENTITY_INHERITORS with a reason.`,
      );
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("has no stale acknowledgements (every acknowledged route still exists and still inherits)", () => {
    const routeSet = new Set(routes);
    const stale: string[] = [];

    for (const route of Object.keys(ACKNOWLEDGED_IDENTITY_INHERITORS)) {
      if (!routeSet.has(route)) {
        stale.push(`${route}: no longer a static shell route — remove from ACKNOWLEDGED_IDENTITY_INHERITORS`);
        continue;
      }
      const prefix = resolvedPrefix(route);
      if (route === prefix) {
        stale.push(`${route}: now has its own entry — remove from ACKNOWLEDGED_IDENTITY_INHERITORS`);
        continue;
      }
      if (!IDENTITY_ASSERTING_PARENTS.includes(prefix)) {
        stale.push(`${route}: no longer inherits an identity-asserting parent — remove from ACKNOWLEDGED_IDENTITY_INHERITORS`);
      }
    }

    expect(stale, stale.join("\n")).toEqual([]);
  });

  it("surfaces the current mislabel debt (visible, non-blocking blast-radius record)", () => {
    const needsProvider = Object.entries(ACKNOWLEDGED_IDENTITY_INHERITORS)
      .filter(([, reason]) => reason.startsWith("NEEDS-PROVIDER"))
      .map(([route]) => route);
    if (needsProvider.length > 0) {
      // Intentional visibility — the blast-radius record the design doc asks
      // planning to be able to see. Not a failure; it's tracked debt.
      console.warn(
        `[coworker-perception] ${needsProvider.length} route(s) still inherit an identity-asserting ` +
          `entry's page identity and need their own entry:\n  ${needsProvider.join("\n  ")}`,
      );
    }
    // The count is expected to only ever go DOWN. Pinning the known ceiling makes
    // adding a new NEEDS-PROVIDER a conscious, reviewed act rather than silent
    // accretion.
    expect(needsProvider.length).toBeLessThanOrEqual(8);
  });
});
