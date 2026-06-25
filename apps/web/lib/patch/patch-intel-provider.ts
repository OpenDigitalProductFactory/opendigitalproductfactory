// Live version-intelligence provider for the patch projector.
//
// For each piece of discovered software, resolves OSV advisories (vulnerabilities)
// for the ecosystems OSV can query reliably, and marks CISA KEV membership. The OSV
// fetcher is injected so this composition is unit-testable without a network call.
//
// Scope (v1): OSV gives "is this version vulnerable + fixed-in", which yields
// vulnerability findings (the highest-value posture signal). It does NOT give "latest
// available version", so plain behind-on-version (`patch-gap`) and end-of-life findings
// come later from the native-manager adapter (Edge Node on-host "installed -> available").

import {
  osvVulnsToAdvisories,
  type OsvVuln,
  type PatchIntel,
  type PatchIntelProvider,
  type SoftwareEvidenceLike,
} from "@dpf/db/patch";

import { osvEcosystemFor } from "./ecosystem-map";

/** Fetch OSV vulns for one package@version in an OSV ecosystem. */
export type OsvVulnFetcher = (ecosystem: string, name: string, version: string) => Promise<OsvVuln[]>;

export interface OsvProviderOptions {
  fetchVulns: OsvVulnFetcher;
  /** CISA KEV CVE ids; advisories whose CVE alias is in this set are flagged exploited. */
  kevCves: ReadonlySet<string>;
}

/**
 * Build a PatchIntelProvider backed by OSV + CISA KEV. Returns null intel (no finding)
 * when the manager is not an OSV ecosystem, identity/version is missing, OSV finds
 * nothing, or OSV is unreachable for that item — never fabricates a verdict.
 */
export function createOsvPatchIntelProvider(options: OsvProviderOptions): PatchIntelProvider {
  return async (evidence: SoftwareEvidenceLike): Promise<PatchIntel | null> => {
    const ecosystem = osvEcosystemFor(evidence.packageManager);
    const name = evidence.rawPackageName ?? evidence.rawProductName ?? null;
    if (!ecosystem || !name || !evidence.rawVersion) return null;

    let vulns: OsvVuln[];
    try {
      vulns = await options.fetchVulns(ecosystem, name, evidence.rawVersion);
    } catch {
      return null; // OSV unreachable for this item — skip rather than fabricate
    }
    if (vulns.length === 0) return null;

    const advisories = osvVulnsToAdvisories(vulns, {
      ecosystem,
      packageName: name,
      kevCves: options.kevCves,
    });
    return { advisories };
  };
}
