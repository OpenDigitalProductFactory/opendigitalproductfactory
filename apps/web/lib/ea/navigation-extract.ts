// apps/web/lib/ea/navigation-extract.ts
//
// Pure extractor for the Navigation SysML projection (Parity Engine, living-graph —
// EP-NAV-COHERENCE / EP-PARITY-ENGINE). Projects the platform's NAVIGATION surface —
// the canonical portal-navigation-model entries — into the architecture graph and
// links each entry to the route it reaches, so navigation becomes a first-class,
// queryable, drift-proof surface instead of being invisible.
//
// THE GAP THIS CLOSES: route-extract.ts already projects the route TREE (an
// "Application Routes" package, containment by URL segment), but the graph had no
// model of which routes are REACHABLE from navigation, nor of cross-domain jumps.
// So "which routes have no nav entry (orphans)?" and "which nav entry crosses a
// domain (teleport)?" could not be answered from the graph — only by an ad-hoc
// filesystem census. This is the same defect class as the scheduling surface
// (scheduled-job-extract.ts): a real surface absent from the code graph.
//
// SysML mapping (intra-model `contains`; cross-LAYER `traces` to the route surface,
// applied by applySysmlModel.crossLayerRelationships):
//   - package         navigation:pkg                     "Navigation"
//   - domain surface  navigation:surface:<domain>        part_definition (one per nav domain)
//   - nav entry       navigation:entry:<key>             part_usage (one canonical nav record)
//   Each entry `traces` to the route-surface node `route:<path>` (route-extract's key),
//   the edge that makes "is this route reachable from nav?" a graph fact and lets a
//   route change's blast_radius reach the nav that exposes it.
//
// Conformance findings (idempotent, surfaced on the EA canvas):
//   - route-not-in-canonical-nav  (orphan)  — a real route reachable only via a
//       per-domain nav component, not the canonical model; the P3 convergence backlog.
//   - nav-entry-crosses-domain    (teleport) — an entry whose target route lives in a
//       different domain than the entry itself (the Platform->Admin defect class).
//   - nav-entry-redirects-cross-domain (teleport via redirect) — an entry whose href looks
//       in-domain but whose route is a redirect SHIM that lands in another domain (e.g. an
//       AI-Operations tab → /platform/ai/capability-needs → /ops). Invisible to the
//       href-only check; caught by following redirect shims to the effective destination.

import type { SysmlDesiredModel, SysmlDesiredConformanceIssue } from "./sysml-model-seed";
import type { PortalNavRecord } from "../navigation/portal-navigation-model";
import type { InteractionStepRole } from "./interaction-shape";

export const NAVIGATION_PACKAGE_KEY = "navigation:pkg";

/** One navigation affordance, normalized from a canonical nav source by the reconcile
 *  shell so this extractor stays pure (no import of the nav model or route manifest). */
export interface NavSourceEntry {
  /** Stable unique key for the entry (e.g. the canonical nav record key). */
  key: string;
  /** Human label as shown in the UI. */
  label: string;
  /** The route path this entry navigates to (route-extract keys it as `route:<path>`). */
  path: string;
  /** The domain the ENTRY belongs to (its owning surface). */
  domain: string;
  /** The domain the EFFECTIVE target route belongs to (resolved by the shell, AFTER
   *  following any redirect shim). A mismatch with `domain` is a cross-domain teleport. */
  targetDomain: string;
  /** When `path` is a redirect shim, the route it actually lands on (query stripped);
   *  absent when the href is a direct destination. */
  effectivePath?: string;
  /** True when the target domain is reached by following a redirect shim rather than the
   *  href directly — the teleport the parity engine's href-only check used to miss. */
  viaRedirect?: boolean;
  /** Optional interaction-shape lane when a richer extractor has already resolved it. */
  jobLane?: string;
  /** Optional role of this surface inside a human job path. Includes `delegate`. */
  stepRole?: InteractionStepRole;
  /** Next surface keys, or for `delegate`, the receiving job lane(s). */
  continuesTo?: readonly string[];
  /** Optional operational value-stream stage this entry serves. */
  spineStage?: string;
}

/** A map of redirect-shim route path → its destination route path (query stripped),
 *  derived from the build-time route manifest by the reconcile shell. Passed in (not
 *  imported) so this extractor stays pure. */
export type RedirectMap = ReadonlyMap<string, string>;

/** Follow redirect shims from `path` to the route actually rendered — strips query/hash
 *  and guards against cycles. Returns the final path and whether any redirect hop occurred,
 *  so a nav entry whose href is itself a shim resolves to its EFFECTIVE destination. */
export function resolveEffectivePath(
  path: string,
  redirects: RedirectMap,
): { path: string; viaRedirect: boolean } {
  let current = path.split(/[?#]/)[0]!;
  const seen = new Set<string>([current]);
  let viaRedirect = false;
  for (let i = 0; i < 16; i++) {
    const next = redirects.get(current);
    if (!next) break;
    const dest = next.split(/[?#]/)[0]!;
    if (seen.has(dest)) break; // cycle guard
    seen.add(dest);
    current = dest;
    viaRedirect = true;
  }
  return { path: current, viaRedirect };
}

export interface NavigationModelInput {
  entries: readonly NavSourceEntry[];
  /** Every route path the app serves (from the build-time route manifest), used to
   *  compute orphans = routes with no canonical nav entry. Dynamic/detail paths
   *  (containing a `[` segment) are excluded — they are never primary nav targets. */
  routePaths: readonly string[];
  /** Per-domain nav components not yet projected (heterogeneous .tsx TABS that need a
   *  pure data extraction first — P5). Their routes are excluded from the orphan set so
   *  the count is not misleading. First path segment, e.g. "finance", "compliance". */
  unprojectedNavDomains?: readonly string[];
}

const ROUTE_KEY = (path: string) => `route:${path}`;
const isDynamic = (path: string) => /\[/.test(path);
const firstSegment = (path: string) => path.split("/").filter(Boolean)[0] ?? "";

export function buildNavigationModel(input: NavigationModelInput): SysmlDesiredModel {
  const { entries, routePaths, unprojectedNavDomains = [] } = input;
  const elements: SysmlDesiredModel["elements"] = [];
  const relationships: SysmlDesiredModel["relationships"] = [];
  const crossLayerRelationships: SysmlDesiredModel["relationships"] = [];
  const conformanceIssues: SysmlDesiredConformanceIssue[] = [];

  elements.push({
    sysmlKey: NAVIGATION_PACKAGE_KEY,
    typeSlug: "package",
    name: "Navigation",
    description:
      "Live SysML projection of the platform's canonical navigation model — the rail and section entries and the route each one reaches — derived from portal-navigation-model so navigation is a first-class, drift-proof surface in the architecture graph and route reachability is a queryable fact.",
    properties: { sourceKey: "portal-navigation-model", entryCount: entries.length },
  });

  // One surface part_definition per distinct entry domain; entries nest under it.
  const domains = [...new Set(entries.map((e) => e.domain))].sort();
  for (const domain of domains) {
    const surfaceKey = `navigation:surface:${domain}`;
    elements.push({
      sysmlKey: surfaceKey,
      typeSlug: "part_definition",
      name: `${domain} navigation`,
      description: `Navigation entries that belong to the ${domain} domain surface.`,
      properties: { sourceKey: surfaceKey, layer: "experience", domain },
    });
    relationships.push({ fromKey: NAVIGATION_PACKAGE_KEY, toKey: surfaceKey, relSlug: "contains" });
  }

  for (const entry of [...entries].sort((a, b) => a.key.localeCompare(b.key))) {
    const entryKey = `navigation:entry:${entry.key}`;
    const surfaceKey = `navigation:surface:${entry.domain}`;
    elements.push({
      sysmlKey: entryKey,
      typeSlug: "part_usage",
      name: entry.label,
      description: `Navigates to ${entry.path}.`,
      properties: {
        sourceKey: entryKey,
        layer: "experience",
        refinementLevel: "actual",
        navKey: entry.key,
        domain: entry.domain,
        targetPath: entry.path,
        targetDomain: entry.targetDomain,
        ...(entry.viaRedirect ? { viaRedirect: true, effectivePath: entry.effectivePath } : {}),
        ...(entry.jobLane ? { jobLane: entry.jobLane } : {}),
        ...(entry.stepRole ? { stepRole: entry.stepRole } : {}),
        ...(entry.continuesTo?.length ? { continuesTo: [...entry.continuesTo] } : {}),
        ...(entry.spineStage ? { spineStage: entry.spineStage } : {}),
      },
    });
    relationships.push({ fromKey: surfaceKey, toKey: entryKey, relSlug: "contains" });
    // Cross-layer: this nav entry traces to (navigates to) the route-surface node.
    crossLayerRelationships.push({ fromKey: entryKey, toKey: ROUTE_KEY(entry.path), relSlug: "traces" });

    // Teleport: the entry's EFFECTIVE target route lives in a different domain than the
    // entry. Two flavours, surfaced as distinct findings so structural analysis can tell
    // them apart:
    if (entry.targetDomain && entry.targetDomain !== entry.domain) {
      if (entry.viaRedirect) {
        // Href looks in-domain but the page redirects out — the teleport the old
        // href-only check could not see (e.g. an AI-Operations tab whose route redirects
        // to /ops). Now caught because the model follows redirect shims.
        conformanceIssues.push({
          onKey: entryKey,
          issueType: "nav-entry-redirects-cross-domain",
          severity: "high",
          message: `Navigation entry "${entry.label}" (${entry.domain}) points at ${entry.path}, which REDIRECTS to ${entry.effectivePath} in the ${entry.targetDomain} domain — a cross-domain teleport via a redirect shim. The href looks in-section but lands in another section; link straight to the real destination or reach it from the persistent rail.`,
        });
      } else {
        conformanceIssues.push({
          onKey: entryKey,
          issueType: "nav-entry-crosses-domain",
          severity: "high",
          message: `Navigation entry "${entry.label}" (${entry.domain}) points at ${entry.path} in the ${entry.targetDomain} domain — a cross-domain teleport. Reach another domain from the persistent rail, not a secondary-nav entry.`,
        });
      }
    }
  }

  // Orphans: real (non-dynamic) routes with no canonical nav entry, excluding routes
  // owned by per-domain navs not yet projected (so the count is the genuine canonical
  // coverage gap, not a misleading total).
  const navTargets = new Set(entries.map((e) => e.path));
  const unprojected = new Set(unprojectedNavDomains);
  const orphans = [...new Set(routePaths)]
    .filter((p) => !isDynamic(p))
    .filter((p) => !navTargets.has(p))
    .filter((p) => !unprojected.has(firstSegment(p)))
    .sort();
  if (orphans.length > 0) {
    const sample = orphans.slice(0, 12).join(", ");
    conformanceIssues.push({
      onKey: NAVIGATION_PACKAGE_KEY,
      issueType: "route-not-in-canonical-nav",
      severity: "medium",
      message: `${orphans.length} route(s) are reachable by URL but have no entry in the canonical navigation model (they are exposed only by per-domain nav components — the parallel taxonomies to converge under EP-NAV-COHERENCE P3). Examples: ${sample}${orphans.length > 12 ? ", …" : ""}.`,
    });
  }

  return {
    elements,
    relationships,
    elementTypeSlugs: ["package", "part_definition", "part_usage"],
    relTypeSlugs: ["contains", "traces"],
    view: {
      name: "Navigation — Live Projection",
      description:
        "Live, system-maintained projection of the canonical navigation model and the route each entry reaches, with orphan-route and cross-domain-teleport conformance findings.",
      viewpointName: "System Decomposition & Interfaces",
      scopeRef: "navigation",
    },
    softRemovePrefix: "navigation:",
    crossLayerRelationships,
    conformanceIssues,
  };
}

/** Resolve the domain a route path belongs to: the domain of the longest canonical nav
 *  record whose path is a prefix of (or equal to) `path`. Lets the teleport guard flag
 *  an entry whose target route lives in a different domain than the entry itself. Falls
 *  back to `fallback` when no canonical ancestor matches (no false positive). Pure. */
export function buildDomainResolver(
  records: readonly Pick<PortalNavRecord, "path" | "domain">[],
): (path: string, fallback: string) => string {
  const byPath = [...records]
    .map((r) => ({ path: r.path, domain: r.domain }))
    .sort((a, b) => b.path.length - a.path.length);
  return (path, fallback) => {
    for (const r of byPath) {
      if (path === r.path || path.startsWith(`${r.path}/`)) return r.domain;
    }
    return fallback;
  };
}

/** Normalize the canonical nav records into pure NavSourceEntry rows: drop legacy
 *  redirects and resolve each entry's target-route domain (for teleport detection).
 *  Pure — the reconcile shell passes PORTAL_NAV_ROUTES. */
export function toNavEntries(
  records: readonly PortalNavRecord[],
  redirects: RedirectMap = new Map(),
): NavSourceEntry[] {
  const domainOf = buildDomainResolver(records);
  return records
    .filter((r) => r.destinationKind !== "legacy-redirect")
    .map((r) => {
      const eff = resolveEffectivePath(r.path, redirects);
      return {
        key: r.key,
        label: r.label,
        path: r.path,
        domain: r.domain,
        // Resolve the domain of the EFFECTIVE destination — following a redirect shim —
        // so an href that looks in-domain but bounces out is caught as a teleport.
        targetDomain: domainOf(eff.path, r.domain),
        ...(eff.viaRedirect ? { effectivePath: eff.path, viaRedirect: true } : {}),
      };
    });
}
