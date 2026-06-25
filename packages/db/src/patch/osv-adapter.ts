// Pure adapters that turn external advisory data into the AdvisoryInput shape the
// patch classifier consumes. No network, no database — the live fetch + scheduling
// lives in the projector slice; these are the transforms, kept pure and testable.
//
// The OSV vuln object shape and severity/fixed/alias extraction mirror the existing,
// proven npm scanner (scripts/sbom/scan-dependencies.mjs) so the two stay consistent;
// this generalizes it to any ecosystem and adds CISA KEV enrichment.

import type { AdvisoryInput, PatchSeverity } from "./patch-intel";

interface OsvEvent {
  introduced?: string;
  fixed?: string;
  last_affected?: string;
}

interface OsvRange {
  type?: string;
  events?: OsvEvent[];
}

interface OsvAffectedPackage {
  ecosystem?: string;
  name?: string;
  purl?: string;
}

interface OsvAffected {
  package?: OsvAffectedPackage;
  ranges?: OsvRange[];
  versions?: string[];
}

/** Minimal OSV vulnerability object (https://ossf.github.io/osv-schema/). */
export interface OsvVuln {
  id: string;
  aliases?: string[];
  summary?: string;
  details?: string;
  severity?: Array<{ type?: string; score?: string }>;
  database_specific?: { severity?: string } & Record<string, unknown>;
  affected?: OsvAffected[];
}

export interface OsvAdapterOptions {
  /** Restrict fixed-version extraction to this ecosystem (e.g. "npm", "Debian"). */
  ecosystem?: string | null;
  /** Restrict fixed-version extraction to this package name. */
  packageName?: string | null;
  /** CISA KEV CVE ids; an advisory whose CVE alias is in this set is marked exploited. */
  kevCves?: ReadonlySet<string> | null;
}

// OSV / GHSA use "moderate"; the platform severity vocabulary uses "medium".
const OSV_SEVERITY_TO_PATCH: Record<string, PatchSeverity> = {
  critical: "critical",
  high: "high",
  moderate: "medium",
  medium: "medium",
  low: "low",
};

/**
 * Map an OSV vuln's coarse severity band. Returns null when only a CVSS vector is
 * present (we do not parse the vector here — GHSA almost always sets a band), letting
 * the classifier fall back to its own default rather than fabricate a level.
 */
export function mapOsvSeverity(vuln: OsvVuln): PatchSeverity | null {
  const band = vuln.database_specific?.severity;
  if (typeof band === "string") {
    const mapped = OSV_SEVERITY_TO_PATCH[band.toLowerCase()];
    if (mapped) return mapped;
  }
  return null;
}

/** CVE and GHSA aliases for a vuln, including its own id. */
export function osvAliases(vuln: OsvVuln): { cve: string[]; ghsa: string[] } {
  const ids = [vuln.id, ...(vuln.aliases ?? [])];
  return {
    cve: ids.filter((x) => /^CVE-/i.test(x)),
    ghsa: ids.filter((x) => /^GHSA-/i.test(x)),
  };
}

/**
 * Lowest "fixed" version across the matching affected entries, or null if none is
 * published. Optionally filtered by ecosystem + package name. Sort is lexical to
 * match the existing scanner; the classifier treats this as a hint, not gospel.
 */
export function osvFixedVersion(
  vuln: OsvVuln,
  ecosystem?: string | null,
  packageName?: string | null,
): string | null {
  const fixed = new Set<string>();
  for (const aff of vuln.affected ?? []) {
    if (ecosystem && aff.package?.ecosystem !== ecosystem) continue;
    if (packageName && aff.package?.name !== packageName) continue;
    for (const range of aff.ranges ?? []) {
      for (const event of range.events ?? []) {
        if (event.fixed) fixed.add(event.fixed);
      }
    }
  }
  const sorted = [...fixed].sort();
  return sorted[0] ?? null;
}

/**
 * Convert one OSV vuln into an AdvisoryInput. Prefers a CVE id (so KEV matching and
 * operator-facing references line up), then GHSA, then the raw OSV id.
 */
export function osvVulnToAdvisory(vuln: OsvVuln, options: OsvAdapterOptions = {}): AdvisoryInput {
  const { cve, ghsa } = osvAliases(vuln);
  const id = cve[0] ?? ghsa[0] ?? vuln.id;
  const cisaKev = options.kevCves ? cve.some((c) => options.kevCves!.has(c)) : false;
  return {
    id,
    severity: mapOsvSeverity(vuln),
    fixedVersion: osvFixedVersion(vuln, options.ecosystem, options.packageName),
    cisaKev,
  };
}

/** Convert a list of OSV vulns (e.g. the `vulns` array for one package) into advisories. */
export function osvVulnsToAdvisories(vulns: OsvVuln[], options: OsvAdapterOptions = {}): AdvisoryInput[] {
  return vulns.map((v) => osvVulnToAdvisory(v, options));
}

interface KevCatalog {
  vulnerabilities?: Array<{ cveID?: string }>;
}

/**
 * Parse the CISA Known Exploited Vulnerabilities catalog
 * (https://www.cisa.gov/.../known_exploited_vulnerabilities.json) into a CVE id set.
 */
export function parseKevCatalog(catalog: KevCatalog | null | undefined): Set<string> {
  const set = new Set<string>();
  for (const entry of catalog?.vulnerabilities ?? []) {
    if (entry?.cveID) set.add(entry.cveID);
  }
  return set;
}
