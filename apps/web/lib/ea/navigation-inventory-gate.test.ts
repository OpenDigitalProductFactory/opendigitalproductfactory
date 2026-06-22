import { describe, expect, it } from "vitest";

import routeManifest from "./route-manifest.json";
import { getAllNavEntries } from "./domain-nav-sources";
import type { RouteManifestRow } from "./route-extract";

// Inventory gate (EP-NAV-COHERENCE P7, BI-E7D871ED) — the CI face of the navigation
// parity surface (BI-E71E7FA5). Locks two invariants so the founder-reported defects
// cannot silently regress:
//   1. The canonical navigation model has ZERO cross-domain teleports (complaint #1 —
//      Platform Hub -> Core Admin yanked the user into another context).
//   2. Every PAGE route with no canonical nav entry (orphan) lives under a KNOWN
//      top-level segment, so a brand-new feature area cannot ship with no navigation.
// The full orphan-count ratchet (driving the per-domain-nav backlog toward zero as P3
// converges the parallel taxonomies) is tracked by the live reconcile-navigation
// conformance findings; this gate prevents NEW un-navigated top-level areas.

const manifest = routeManifest as { routes?: RouteManifestRow[] };
const firstSegment = (p: string) => p.split("/").filter(Boolean)[0] ?? "";

// Every top-level URL segment served by a PAGE route today (across all route groups),
// enumerated from the App Router tree. An orphan under a segment NOT in this set fails
// the gate: add the route to the navigation model, or add the segment here on purpose.
const KNOWN_NAV_TOPLEVEL = new Set<string>([
  "admin", "build", "complaints", "compliance", "customer", "customer-complete-profile",
  "customer-link-account", "customer-login", "customer-signup", "docs", "ea", "employee",
  "finance", "forgot-password", "governance", "inventory", "knowledge", "login",
  "member-equity", "ops", "platform", "portal", "portfolio", "rental", "reset-password",
  "s", "sandbox-restricted", "service-requests", "setup", "storefront", "welcome",
  "wiki", "workbooks", "workspace",
]);

describe("navigation inventory gate (EP-NAV-COHERENCE P7)", () => {
  const entries = getAllNavEntries();

  // Orphans are computed over PAGE routes only — API route handlers never carry nav.
  const pageRoutes = (manifest.routes ?? [])
    .filter((r) => r.kind === "page")
    .map((r) => r.routePath);
  const navTargets = new Set(entries.map((e) => e.path));
  const orphans = [...new Set(pageRoutes)]
    .filter((p) => p !== "/")
    .filter((p) => !/\[/.test(p)) // dynamic/detail routes are never primary nav targets
    .filter((p) => !navTargets.has(p));

  it("has zero cross-domain teleports in the canonical navigation model", () => {
    const teleports = entries.filter((e) => e.domain !== e.targetDomain);
    expect(
      teleports,
      `cross-domain nav teleport(s): ${teleports.map((e) => `${e.label}->${e.path}`).join(", ")}`,
    ).toEqual([]);
  });

  it("keeps every orphan route under a known top-level segment (no un-navigated new area)", () => {
    const unexpected = orphans.filter((p) => !KNOWN_NAV_TOPLEVEL.has(firstSegment(p)));
    expect(
      unexpected,
      `route(s) under a top-level segment with no navigation — add to the nav model or KNOWN_NAV_TOPLEVEL: ${unexpected.join(", ")}`,
    ).toEqual([]);
  });

  it("projects a non-empty canonical navigation surface", () => {
    expect(entries.length).toBeGreaterThan(10);
    expect(entries.every((e) => e.path.startsWith("/"))).toBe(true);
  });

  it("counts Finance section routes as navigable, not orphans (P3 convergence)", () => {
    for (const p of ["/finance/invoices", "/finance/bills", "/finance/reports", "/finance/banking"]) {
      expect(orphans, `${p} should be covered by the converged Finance nav source`).not.toContain(p);
    }
  });
});
