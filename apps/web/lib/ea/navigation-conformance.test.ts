// apps/web/lib/ea/navigation-conformance.test.ts
//
// The enforcing GATE for navigation coherence (EP-829D997C / BI-3C270C42).
//
// buildNavigationModel already DETECTS cross-domain "teleports" — a secondary-nav
// entry (canonical OR per-domain section nav) whose effective target route lives in
// a different domain than the entry. That is the founder-reported "a submenu item
// takes me entirely out of the section I navigated from" defect. But detection was
// only surfaced as advisory conformance findings on the living graph; nothing FAILED
// when a new teleport landed.
//
// This test is the ratchet that closes the loop: it re-derives the live navigation
// model from the exact same sources the reconcile projection uses (canonical
// portal-navigation-model + registered per-domain navs + the build-time redirect
// manifest) and fails if a NEW teleport appears beyond the checked-in baseline. Fix a
// teleport (link straight to the destination, or reach it from the persistent rail),
// then remove its key from navigation-teleport-baseline.json and the gate tightens.
//
// Orphans (route-not-in-canonical-nav) are intentionally NOT gated here — they are the
// known EP-NAV-COHERENCE P3 convergence backlog, tracked separately.

import { describe, expect, it } from "vitest";

import routeManifestData from "./route-manifest.json";
import { buildNavigationModel, type NavSourceEntry } from "./navigation-extract";
import { getAllNavEntries } from "./domain-nav-sources";
import teleportBaseline from "./navigation-teleport-baseline.json";
import type { RouteManifestRow } from "./route-extract";

const TELEPORT_ISSUE_TYPES = new Set([
  "nav-entry-crosses-domain",
  "nav-entry-redirects-cross-domain",
]);

/** Re-derive the live teleport findings exactly as reconcileNavigation assembles them. */
function currentTeleports() {
  const routes =
    ((routeManifestData as { routes?: RouteManifestRow[] }).routes ?? []);
  const redirectMap = new Map<string, string>(
    routes.flatMap((r) =>
      r.redirectTo ? [[r.routePath, r.redirectTo] as [string, string]] : [],
    ),
  );
  const routePaths = routes
    .filter((r) => r.kind === "page" && !r.redirectTo)
    .map((r) => r.routePath);
  const entries = getAllNavEntries(redirectMap);
  const model = buildNavigationModel({ entries, routePaths });
  return (model.conformanceIssues ?? []).filter((i) =>
    TELEPORT_ISSUE_TYPES.has(i.issueType),
  );
}

describe("navigation conformance gate (EP-829D997C / BI-3C270C42)", () => {
  const baseline = new Set(teleportBaseline as string[]);

  it("introduces no NEW cross-domain teleport beyond the baseline", () => {
    const novel = currentTeleports().filter((t) => !baseline.has(t.onKey));
    // Assert on the human-readable messages so a failure names the offending
    // entries and how to fix them, not just an opaque count.
    expect(novel.map((t) => t.message)).toEqual([]);
  });

  it("has no stale baseline entries (retighten when a teleport is fixed)", () => {
    const liveKeys = new Set(currentTeleports().map((t) => t.onKey));
    const stale = [...baseline].filter((k) => !liveKeys.has(k));
    expect(stale).toEqual([]);
  });

  it("has teeth — a section-nav entry pointing into another domain IS flagged", () => {
    // Proves the gate is not a vacuous pass: a platform-domain entry whose target
    // route resolves to the business domain must surface as a teleport finding.
    const entries: NavSourceEntry[] = [
      { key: "platform_home", label: "Platform", path: "/platform", domain: "platform", targetDomain: "platform" },
      { key: "platform_to_finance", label: "Finance", path: "/finance", domain: "platform", targetDomain: "business" },
    ];
    const model = buildNavigationModel({ entries, routePaths: ["/platform", "/finance"] });
    const teleports = (model.conformanceIssues ?? []).filter((i) =>
      TELEPORT_ISSUE_TYPES.has(i.issueType),
    );
    expect(teleports).toHaveLength(1);
    expect(teleports[0]?.issueType).toBe("nav-entry-crosses-domain");
    expect(teleports[0]?.onKey).toBe("navigation:entry:platform_to_finance");
  });
});
