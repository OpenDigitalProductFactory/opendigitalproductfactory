// apps/web/lib/ea/domain-nav-sources.ts
//
// Per-domain navigation sources registered into the ONE navigation surface
// (EP-NAV-COHERENCE P3 — converge the parallel per-domain navs). The canonical
// portal-navigation-model is a curated subset (rail + section seeds); each domain also
// ships its own secondary nav (finance-nav, ComplianceTabNav, EaTabNav, …) whose routes
// were invisible to the surface and showed as `route-not-in-canonical-nav` orphans.
// This registers those navs as additional NavSourceEntry rows — read-time unification,
// NOT a second copy of the data — so their routes join the navigation surface, get
// `navigates-to` edges, and leave the orphan set. The orphan count therefore drops to
// the genuinely-unreachable routes.
//
// Slice 1 ingests Finance (the biggest orphan cluster and already a pure-data nav).
// The .tsx TABS navs (compliance/ea/ops/customer-marketing/employee/storefront) are
// ingested as their arrays are extracted to pure data modules (composes P5).

import { FINANCE_FAMILIES } from "@/components/finance/finance-nav";
import { PORTAL_NAV_ROUTES } from "@/lib/navigation/portal-navigation-model";
import { toNavEntries, buildDomainResolver, type NavSourceEntry } from "./navigation-extract";

interface DomainNavSource {
  /** PortalDomain the entries belong to (their owning surface). */
  domain: string;
  /** Distinct {key,label,path} affordances this nav exposes. */
  entries: Array<{ key: string; label: string; path: string }>;
}

/** Flatten the Finance family nav (families + their sub-items) to distinct route rows. */
function financeSource(): DomainNavSource {
  const seen = new Set<string>();
  const entries: DomainNavSource["entries"] = [];
  for (const fam of FINANCE_FAMILIES) {
    for (const item of [{ label: fam.label, href: fam.href }, ...fam.subItems]) {
      if (seen.has(item.href)) continue;
      seen.add(item.href);
      entries.push({ key: `finance:${item.href}`, label: item.label, path: item.href });
    }
  }
  return { domain: "business", entries };
}

const DOMAIN_NAV_SOURCES: readonly DomainNavSource[] = [financeSource()];

/** Per-domain nav entries normalized to NavSourceEntry. targetDomain is resolved from
 *  the route's canonical domain so a per-domain nav that points OUT of its own domain
 *  is still caught as a teleport. */
export function getDomainNavEntries(): NavSourceEntry[] {
  const domainOf = buildDomainResolver(PORTAL_NAV_ROUTES);
  return DOMAIN_NAV_SOURCES.flatMap((src) =>
    src.entries.map((e) => ({
      key: e.key,
      label: e.label,
      path: e.path,
      domain: src.domain,
      targetDomain: domainOf(e.path, src.domain),
    })),
  );
}

/** The single source of navigation reachability: canonical nav entries plus the
 *  registered per-domain nav entries, deduped by path (canonical wins). Used by both
 *  the reconcile projection and the inventory gate so they agree. */
export function getAllNavEntries(): NavSourceEntry[] {
  const byPath = new Map<string, NavSourceEntry>();
  for (const e of toNavEntries(PORTAL_NAV_ROUTES)) byPath.set(e.path, e);
  for (const e of getDomainNavEntries()) {
    if (!byPath.has(e.path)) byPath.set(e.path, e);
  }
  return [...byPath.values()];
}
