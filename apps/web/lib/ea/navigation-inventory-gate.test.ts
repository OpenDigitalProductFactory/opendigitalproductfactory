import { describe, expect, it } from "vitest";

import routeManifest from "./route-manifest.json";
import { getAllNavEntries } from "./domain-nav-sources";
import type { RouteManifestRow } from "./route-extract";

// Inventory gate (EP-NAV-COHERENCE P7, BI-E7D871ED) — the CI face of the navigation
// parity surface (BI-E71E7FA5). Locks two invariants so the founder-reported defects
// cannot silently regress:
//   1. The navigation model has ZERO cross-domain teleports — INCLUDING redirect-disguised
//      ones: a nav entry whose href looks in-domain but whose route is a redirect shim
//      that lands in another domain (complaint #1 — Platform Hub -> Core Admin, and its
//      sibling, the "Capability Needs" tab that redirected to /ops). The gate follows
//      redirect shims (from the route manifest) so this is caught at PR time, not in the
//      operator's hands.
//   2. Every PAGE route with no canonical nav entry (orphan) lives under a KNOWN
//      top-level segment, so a brand-new feature area cannot ship with no navigation.
// The full orphan-count ratchet (driving the per-domain-nav backlog toward zero as P3
// converges the parallel taxonomies) is tracked by the live reconcile-navigation
// conformance findings; this gate prevents NEW un-navigated top-level areas.

const manifest = routeManifest as { routes?: RouteManifestRow[] };
const firstSegment = (p: string) => p.split("/").filter(Boolean)[0] ?? "";

// Redirect shims (route path → destination) from the build-time manifest, so the gate
// resolves each nav entry's EFFECTIVE destination domain and catches redirect teleports.
const redirectMap = new Map<string, string>(
  (manifest.routes ?? []).flatMap((r) => (r.redirectTo ? [[r.routePath, r.redirectTo] as [string, string]] : [])),
);

// Every top-level URL segment served by a PAGE route today (across all route groups),
// enumerated from the App Router tree. An orphan under a segment NOT in this set fails
// the gate: add the route to the navigation model, or add the segment here on purpose.
const KNOWN_NAV_TOPLEVEL = new Set<string>([
  "admin", "build", "complaints", "compliance", "customer", "customer-complete-profile",
  "customer-link-account", "customer-login", "customer-signup", "docs", "ea", "employee",
  "finance", "forgot-password", "governance", "inventory", "knowledge", "login",
  "member-equity", "ops", "platform", "portal", "portfolio", "rental", "reset-password",
  "s", "sandbox-restricted", "service-requests", "setup", "storefront", "welcome",
  "coworker-decisions", "workbooks", "workspace",
]);

describe("navigation inventory gate (EP-NAV-COHERENCE P7)", () => {
  const entries = getAllNavEntries(redirectMap);

  // Orphans are computed over PAGE routes only — API route handlers never carry nav — and
  // exclude redirect shims (a shim is not a real destination needing its own nav entry).
  const pageRoutes = (manifest.routes ?? [])
    .filter((r) => r.kind === "page" && !r.redirectTo)
    .map((r) => r.routePath);
  const navTargets = new Set(entries.map((e) => e.path));
  const orphans = [...new Set(pageRoutes)]
    .filter((p) => p !== "/")
    .filter((p) => !/\[/.test(p)) // dynamic/detail routes are never primary nav targets
    .filter((p) => !navTargets.has(p));

  it("has zero cross-domain teleports (direct or redirect-disguised) in the navigation model", () => {
    const teleports = entries.filter((e) => e.domain !== e.targetDomain);
    expect(
      teleports,
      `cross-domain nav teleport(s): ${teleports
        .map((e) => `${e.label} ${e.path}${e.viaRedirect ? ` →redirect→ ${e.effectivePath}` : ""} (${e.domain}→${e.targetDomain})`)
        .join(", ")}`,
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

  it("keeps the legacy EA agents route pointed at the canonical identity surface", () => {
    const legacyRoute = (manifest.routes ?? []).find(
      (r) => r.routePath === "/ea/agents",
    );

    expect(legacyRoute?.redirectTo).toBe("/platform/identity/agents");
    expect((manifest.routes ?? []).some((r) => r.routePath === "/admin/agents")).toBe(
      false,
    );
    expect(
      entries.some(
        (entry) =>
          entry.path === "/admin/agents" ||
          entry.effectivePath === "/admin/agents",
      ),
    ).toBe(false);
  });

  it("counts converged per-domain section routes as navigable, not orphans (P3)", () => {
    for (const p of [
      "/finance/invoices", "/finance/bills", "/finance/reports", "/finance/banking",
      "/admin/settings", "/admin/branding", "/admin/diagnostics",
      "/compliance/risks", "/compliance/controls", "/compliance/audits",
      "/ea/capabilities", "/ea/value-streams", "/ops/changes", "/ops/self-upgrade",
      "/customer/marketing/campaigns", "/customer/marketing/strategy",
      "/storefront/team", "/storefront/inbox", "/storefront/settings/business",
    ]) {
      expect(orphans, `${p} should be covered by a converged per-domain nav source`).not.toContain(p);
    }
  });
});
