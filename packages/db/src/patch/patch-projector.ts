// Assessment projector: turns discovered installed-software evidence into patch
// findings on the Assurance Ledger. This is the read-only P0 payoff — "what is out
// of date / vulnerable across the estate" — with no execution and no new findings table.
//
// The projector is decoupled from Prisma behind a small port (PatchAssessmentStore)
// so the read -> assess -> upsert -> resolve orchestration is fully unit-testable with
// a fake store. The real Prisma binding is a thin adapter over this port.

import {
  assessPatchState,
  isActionable,
  type AdvisoryInput,
  type ApplyVia,
  type PatchAssessment,
  type PatchConfidence,
} from "./patch-intel";

/** The fields of a DiscoveredSoftwareEvidence row the projector reads. */
export interface SoftwareEvidenceLike {
  id?: string;
  evidenceKey: string;
  inventoryEntityId: string;
  rawVendor?: string | null;
  rawProductName?: string | null;
  rawPackageName?: string | null;
  rawVersion?: string | null;
  packageManager?: string | null;
  /** Optional MSP scope carried from the owning InventoryEntity. */
  customerAccountId?: string | null;
  customerSiteId?: string | null;
  /** Resolved canonical identity fields, preferably from the evidence row then host. */
  catalogIdentityId?: string | null;
  catalogIdentityCpe?: string | null;
  catalogIdentityPart?: string | null;
  catalogLifecycleMilestones?: CatalogLifecycleMilestoneLike[] | null;
}

export interface CatalogLifecycleMilestoneLike {
  milestone: string;
  date?: string | Date | null;
  source?: string | null;
  confidence?: number | null;
}

/** Version + advisory intelligence for one software item (produced by the feed slice). */
export interface PatchIntel {
  latestStableVersion?: string | null;
  latestSafeVersion?: string | null;
  advisories?: AdvisoryInput[] | null;
  eolDate?: string | Date | null;
  defaultApplyVia?: ApplyVia | null;
  rebootLikely?: boolean | null;
  confidence?: PatchConfidence | null;
}

/** Resolves intelligence for a piece of evidence; returns null when nothing is known. */
export type PatchIntelProvider = (
  evidence: SoftwareEvidenceLike,
) => PatchIntel | null | Promise<PatchIntel | null>;

/** AssuranceFinding upsert payload (composes the existing Assurance Ledger model). */
export interface PatchFindingUpsert {
  findingKey: string;
  findingKind: string;
  title: string;
  description: string;
  affectedType: string;
  affectedId: string;
  adapterKey: string;
  vendorIdentifier: string;
  policySeverity: string;
  remediationHint: Record<string, unknown>;
  source: Record<string, unknown>;
}

/** Port over the persistence layer — kept minimal so the projector is testable. */
export interface PatchAssessmentStore {
  listSoftwareEvidence(): Promise<SoftwareEvidenceLike[]>;
  upsertFinding(finding: PatchFindingUpsert): Promise<void>;
  /** Resolve previously-open patch findings whose key is no longer active (now clean). */
  resolveFindingsExcept(activeFindingKeys: string[]): Promise<number>;
}

export interface PatchAssessmentSummary {
  assessed: number;
  actionable: number;
  resolved: number;
  byKind: Record<string, number>;
  bySeverity: Record<string, number>;
}

const FINDING_KEY_PREFIX = "patch:";

/** Map a discovered package manager to the backend that would apply its updates. */
export function applyViaForPackageManager(pm: string | null | undefined): ApplyVia {
  switch ((pm ?? "").toLowerCase()) {
    case "dpkg":
    case "apt":
      return "apt";
    case "rpm":
    case "dnf":
    case "yum":
      return "dnf";
    case "brew":
    case "homebrew":
      return "brew";
    case "winget":
    case "msi":
    case "powershell":
    case "registry":
      return "winget";
    case "wua":
    case "windows-update":
      return "wua";
    case "npm":
    case "pip":
    case "pypi":
    case "gem":
    case "cargo":
      return "vendor-adapter";
    default:
      return "unknown";
  }
}

function displayName(evidence: SoftwareEvidenceLike): string {
  return (
    evidence.rawProductName ||
    evidence.rawPackageName ||
    evidence.rawVendor ||
    evidence.evidenceKey
  );
}

/** Compose evidence + intelligence into a patch verdict. Pure. */
export function assessEvidence(
  evidence: SoftwareEvidenceLike,
  intel: PatchIntel | null,
  now?: Date,
): PatchAssessment {
  return assessPatchState({
    installedVersion: evidence.rawVersion,
    latestStableVersion: intel?.latestStableVersion ?? null,
    latestSafeVersion: intel?.latestSafeVersion ?? null,
    advisories: intel?.advisories ?? null,
    eolDate: intel?.eolDate ?? null,
    defaultApplyVia: intel?.defaultApplyVia ?? applyViaForPackageManager(evidence.packageManager),
    rebootLikely: intel?.rebootLikely ?? null,
    confidence: intel?.confidence ?? null,
    now,
  });
}

function adapterKeyFor(assessment: PatchAssessment): string {
  if (assessment.cisaKev) return "cisa-kev";
  if (assessment.primaryAdvisorySource === "nvd") return "nvd";
  if (assessment.findingKind === "vulnerability") return "osv";
  return "patch-intel";
}

function titleFor(evidence: SoftwareEvidenceLike, assessment: PatchAssessment): string {
  const name = displayName(evidence);
  const installed = evidence.rawVersion ?? "unknown";
  const target = assessment.remediationHint.targetVersion;
  switch (assessment.findingKind) {
    case "vulnerability":
      return `${name} ${installed} — ${assessment.primaryAdvisoryId ?? "known vulnerability"}`;
    case "end-of-life":
      return `${name} ${installed} is end-of-life`;
    case "patch-gap":
      if (assessment.primaryAdvisoryId) return `${name} ${installed} needs patch for ${assessment.primaryAdvisoryId}`;
      return `${name} ${installed}${target ? ` → ${target}` : ""}`;
    default:
      return `${name} ${installed}`;
  }
}

/**
 * Build the AssuranceFinding upsert for an actionable assessment, or null when there
 * is nothing to do. Stable findingKey so re-runs upsert rather than duplicate.
 */
export function evidenceToPatchFinding(
  evidence: SoftwareEvidenceLike,
  assessment: PatchAssessment,
): PatchFindingUpsert | null {
  if (!isActionable(assessment)) return null;
  const affectedId = evidence.id ?? evidence.evidenceKey;
  const vendorIdentifier =
    assessment.primaryAdvisoryId ??
    `${evidence.packageManager ?? "sw"}:${evidence.rawPackageName ?? evidence.rawProductName ?? "unknown"}`;
  return {
    findingKey: `${FINDING_KEY_PREFIX}${evidence.evidenceKey}`,
    findingKind: assessment.findingKind,
    title: titleFor(evidence, assessment),
    description: assessment.rationale,
    affectedType: "DiscoveredSoftwareEvidence",
    affectedId,
    adapterKey: adapterKeyFor(assessment),
    vendorIdentifier,
    policySeverity: assessment.policySeverity,
    remediationHint: { ...assessment.remediationHint },
    source: {
      installedVersion: evidence.rawVersion ?? null,
      packageManager: evidence.packageManager ?? null,
      inventoryEntityId: evidence.inventoryEntityId,
      customerAccountId: evidence.customerAccountId ?? null,
      customerSiteId: evidence.customerSiteId ?? null,
      versionComparison: assessment.versionComparison,
      cisaKev: assessment.cisaKev,
    },
  };
}

/**
 * Run the read-only patch assessment across all discovered software: assess each
 * piece of evidence, upsert the actionable findings, and resolve findings that have
 * become clean. Returns a posture summary. Pure orchestration over the injected store.
 */
export async function runPatchAssessment(
  store: PatchAssessmentStore,
  provider: PatchIntelProvider,
  options: { now?: Date } = {},
): Promise<PatchAssessmentSummary> {
  const evidence = await store.listSoftwareEvidence();
  const byKind: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  const activeFindingKeys: string[] = [];
  let actionable = 0;

  for (const ev of evidence) {
    const intel = await provider(ev);
    const assessment = assessEvidence(ev, intel, options.now);
    const finding = evidenceToPatchFinding(ev, assessment);
    if (!finding) continue;
    actionable += 1;
    byKind[finding.findingKind] = (byKind[finding.findingKind] ?? 0) + 1;
    bySeverity[finding.policySeverity] = (bySeverity[finding.policySeverity] ?? 0) + 1;
    activeFindingKeys.push(finding.findingKey);
    await store.upsertFinding(finding);
  }

  const resolved = await store.resolveFindingsExcept(activeFindingKeys);

  return { assessed: evidence.length, actionable, resolved, byKind, bySeverity };
}
