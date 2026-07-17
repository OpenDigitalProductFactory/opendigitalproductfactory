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
  type AdvisoryInput,
  type CatalogLifecycleMilestoneLike,
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

export type NvdCveAdvisoryFetcher = (cpeName: string) => Promise<AdvisoryInput[]>;

export interface NvdProviderOptions {
  fetchAdvisories: NvdCveAdvisoryFetcher;
}

const EOL_MILESTONES = new Set(["eol", "eosl", "security_updates_end"]);

export function milestoneEolDate(
  milestones: readonly CatalogLifecycleMilestoneLike[] | null | undefined,
): string | Date | null {
  const selected = (milestones ?? []).find(
    (milestone) => EOL_MILESTONES.has(milestone.milestone) && milestone.date,
  );
  return selected?.date ?? null;
}

export function mergePatchIntel(
  ...parts: Array<PatchIntel | null | undefined>
): PatchIntel | null {
  const present = parts.filter((part): part is PatchIntel => part != null);
  if (present.length === 0) return null;
  const advisories = present.flatMap((part) => part.advisories ?? []);
  const merged: PatchIntel = {};
  for (const part of present) {
    if (part.latestStableVersion) merged.latestStableVersion = part.latestStableVersion;
    if (part.latestSafeVersion) merged.latestSafeVersion = part.latestSafeVersion;
    if (part.eolDate) merged.eolDate = part.eolDate;
    if (part.defaultApplyVia) merged.defaultApplyVia = part.defaultApplyVia;
    if (part.rebootLikely != null) merged.rebootLikely = part.rebootLikely;
    if (part.confidence) merged.confidence = part.confidence;
  }
  if (advisories.length > 0) merged.advisories = advisories;
  return Object.keys(merged).length > 0 ? merged : null;
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

/**
 * Build a PatchIntelProvider backed by CatalogIdentity.cpe -> NVD CVE lookup plus
 * CatalogLifecycleMilestone EOL rows. NVD CVEs are patch posture for installed
 * commercial/OS software, so they project as patch-gap -> Assurance missing-patch.
 */
export function createNvdCpePatchIntelProvider(options: NvdProviderOptions): PatchIntelProvider {
  return async (evidence: SoftwareEvidenceLike): Promise<PatchIntel | null> => {
    const eolDate = milestoneEolDate(evidence.catalogLifecycleMilestones);
    const cpe = evidence.catalogIdentityCpe;
    let advisories: AdvisoryInput[] = [];

    if (typeof cpe === "string" && cpe.length > 0) {
      try {
        advisories = await options.fetchAdvisories(cpe);
      } catch {
        advisories = [];
      }
    }

    const intel = mergePatchIntel(
      advisories.length > 0 ? { advisories, confidence: "verified" } : null,
      eolDate ? { eolDate, confidence: "verified" } : null,
    );
    if (intel && advisories.length === 0 && typeof cpe === "string" && cpe.length > 0) {
      intel.advisories = [];
    }
    return intel;
  };
}
