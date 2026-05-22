import type { AssuranceAdapter, AssuranceRunInput, AssuranceRunOutput } from "./adapter-contract";
import { createFindingKey, normalizeVendorIdentifier } from "./finding-key";
import type {
  AssurancePolicySeverity,
  AssuranceReleaseImpact,
  NormalizedAssuranceFinding,
} from "./types";

export const PNPM_AUDIT_ADAPTER_KEY = "pnpm-audit";
export const PNPM_AUDIT_ADAPTER_VERSION = "1";

export const PNPM_AUDIT_SEVERITIES = ["info", "low", "moderate", "high", "critical"] as const;
export type PnpmAuditSeverity = (typeof PNPM_AUDIT_SEVERITIES)[number];

export interface PnpmAuditAdvisory {
  id?: number | string;
  ghsa_id?: string;
  cves?: string[];
  severity: PnpmAuditSeverity | string;
  title: string;
  url?: string;
  vulnerable_versions?: string;
  patched_versions?: string;
  module_name: string;
  cwe?: string[];
  recommendation?: string;
  paths?: string[];
}

export interface PnpmAuditAdvisoryGroup {
  advisory: PnpmAuditAdvisory;
  occurrences: PnpmAuditOccurrence[];
}

export interface PnpmAuditOccurrence {
  moduleName: string;
  version: string | null;
  path: string | null;
}

interface PnpmAuditJsonShape {
  advisories?: Record<string, PnpmAuditAdvisory & { findings?: Array<{ version: string; paths?: string[] }> }>;
}

export interface ComponentLookupEntry {
  componentId: string;
  componentKey: string;
  name: string;
  version: string | null;
  packageUrl: string | null;
}

export type PnpmAuditComponentLookup = Record<string, ComponentLookupEntry>;

const SEVERITY_TO_POLICY: Record<PnpmAuditSeverity, AssurancePolicySeverity> = {
  critical: "critical",
  high: "high",
  moderate: "medium",
  low: "low",
  info: "info",
};

const SEVERITY_TO_RELEASE_IMPACT: Record<PnpmAuditSeverity, AssuranceReleaseImpact> = {
  critical: "block",
  high: "block",
  moderate: "warn",
  low: "track",
  info: "track",
};

function normalizeSeverity(severity: string): PnpmAuditSeverity {
  const lower = severity.toLowerCase();
  return (PNPM_AUDIT_SEVERITIES as readonly string[]).includes(lower) ? (lower as PnpmAuditSeverity) : "info";
}

export function parsePnpmAuditJson(jsonText: string): PnpmAuditAdvisoryGroup[] {
  if (!jsonText.trim()) return [];

  let parsed: PnpmAuditJsonShape;
  try {
    parsed = JSON.parse(jsonText) as PnpmAuditJsonShape;
  } catch {
    return [];
  }

  const advisories = parsed.advisories;
  if (!advisories || typeof advisories !== "object") return [];

  const groups: PnpmAuditAdvisoryGroup[] = [];

  for (const advisory of Object.values(advisories)) {
    if (!advisory || typeof advisory !== "object" || !advisory.module_name) continue;

    const findings = Array.isArray(advisory.findings) ? advisory.findings : [];
    const occurrences: PnpmAuditOccurrence[] = findings.length > 0
      ? findings.flatMap((finding) => {
          const paths = Array.isArray(finding.paths) && finding.paths.length > 0 ? finding.paths : [null];
          return paths.map((path) => ({
            moduleName: advisory.module_name,
            version: typeof finding.version === "string" ? finding.version : null,
            path,
          }));
        })
      : [{ moduleName: advisory.module_name, version: null, path: null }];

    groups.push({
      advisory: {
        id: advisory.id,
        ghsa_id: advisory.ghsa_id,
        cves: Array.isArray(advisory.cves) ? advisory.cves : undefined,
        severity: advisory.severity,
        title: advisory.title,
        url: advisory.url,
        vulnerable_versions: advisory.vulnerable_versions,
        patched_versions: advisory.patched_versions,
        module_name: advisory.module_name,
        cwe: Array.isArray(advisory.cwe) ? advisory.cwe : undefined,
        recommendation: advisory.recommendation,
      },
      occurrences,
    });
  }

  return groups;
}

function pickVendorIdentifier(advisory: PnpmAuditAdvisory): string {
  if (advisory.ghsa_id) return advisory.ghsa_id;
  if (advisory.cves && advisory.cves.length > 0) return advisory.cves[0];
  if (typeof advisory.id === "number" || typeof advisory.id === "string") return `pnpm-audit:${advisory.id}`;
  return "";
}

function lookupComponent(
  lookup: PnpmAuditComponentLookup,
  moduleName: string,
  version: string | null,
): ComponentLookupEntry | null {
  if (version) {
    const exact = lookup[`${moduleName}@${version}`];
    if (exact) return exact;
  }
  const nameOnly = lookup[moduleName];
  if (nameOnly) return nameOnly;
  return null;
}

function affectedIdFor(
  matched: ComponentLookupEntry | null,
  moduleName: string,
  version: string | null,
): string {
  if (matched?.componentKey) return matched.componentKey;
  return version ? `pkg:npm/${moduleName}@${version}` : `pkg:npm/${moduleName}`;
}

export interface MapAdvisoryInput {
  group: PnpmAuditAdvisoryGroup;
  lookup: PnpmAuditComponentLookup;
}

export interface AdvisoryMappingResult {
  findings: NormalizedAssuranceFinding[];
  componentIdsByAffectedId: Record<string, string>;
}

export function mapAdvisoryToFindings(input: MapAdvisoryInput): AdvisoryMappingResult {
  const { group, lookup } = input;
  const advisory = group.advisory;
  const severity = normalizeSeverity(advisory.severity);
  const vendor = normalizeVendorIdentifier(
    pickVendorIdentifier(advisory),
    `${advisory.module_name}::${advisory.title}`,
  );

  const findings: NormalizedAssuranceFinding[] = [];
  const componentIdsByAffectedId: Record<string, string> = {};
  const seen = new Set<string>();

  for (const occurrence of group.occurrences) {
    const matched = lookupComponent(lookup, occurrence.moduleName, occurrence.version);
    const affectedId = affectedIdFor(matched, occurrence.moduleName, occurrence.version);
    if (seen.has(affectedId)) continue;
    seen.add(affectedId);

    const keyInput = {
      adapterKey: PNPM_AUDIT_ADAPTER_KEY,
      findingKind: "vulnerability" as const,
      affectedType: "bom-component" as const,
      affectedId,
      vendorIdentifier: vendor.identifier,
    };

    findings.push({
      ...keyInput,
      findingKey: createFindingKey(keyInput),
      title: advisory.title,
      description: advisory.recommendation ?? undefined,
      sourceSeverity: advisory.severity,
      policySeverity: SEVERITY_TO_POLICY[severity],
      releaseImpact: SEVERITY_TO_RELEASE_IMPACT[severity],
      reachability: "unknown",
      exposure: "unknown",
      identifierStability: vendor.stability,
      evidence: {
        moduleName: advisory.module_name,
        observedVersion: occurrence.version,
        path: occurrence.path,
        url: advisory.url,
        cwe: advisory.cwe,
        cves: advisory.cves,
        vulnerableVersions: advisory.vulnerable_versions,
        matchedComponentKey: matched?.componentKey ?? null,
        matchedPackageUrl: matched?.packageUrl ?? null,
      },
      remediationHint: {
        patchedVersions: advisory.patched_versions ?? null,
        recommendation: advisory.recommendation ?? null,
      },
    });

    if (matched) {
      componentIdsByAffectedId[affectedId] = matched.componentId;
    }
  }

  return { findings, componentIdsByAffectedId };
}

export interface PnpmAuditAdapterRunInput {
  jsonText: string;
  lookup?: PnpmAuditComponentLookup;
}

export interface PnpmAuditAdapterRunOutput extends AssuranceRunOutput {
  componentIdsByAffectedId: Record<string, string>;
  advisoryCount: number;
}

export function runPnpmAuditAdapter(input: PnpmAuditAdapterRunInput): PnpmAuditAdapterRunOutput {
  const groups = parsePnpmAuditJson(input.jsonText);
  const lookup = input.lookup ?? {};
  const findings: NormalizedAssuranceFinding[] = [];
  const componentIdsByAffectedId: Record<string, string> = {};

  for (const group of groups) {
    const mapped = mapAdvisoryToFindings({ group, lookup });
    findings.push(...mapped.findings);
    Object.assign(componentIdsByAffectedId, mapped.componentIdsByAffectedId);
  }

  const blocking = findings.filter((finding) => finding.releaseImpact === "block").length;

  return {
    status: blocking > 0 ? "failed" : findings.length > 0 ? "partial" : "passed",
    summary: {
      adapter: PNPM_AUDIT_ADAPTER_KEY,
      adapterVersion: PNPM_AUDIT_ADAPTER_VERSION,
      advisoryCount: groups.length,
      findingCount: findings.length,
      blockingCount: blocking,
    },
    findings,
    artifacts: [
      {
        artifactKind: "raw-output",
        name: "pnpm-audit.json",
        value: input.jsonText,
      },
    ],
    componentIdsByAffectedId,
    advisoryCount: groups.length,
  };
}

export function createPnpmAuditAdapter(): AssuranceAdapter {
  return {
    adapterKey: PNPM_AUDIT_ADAPTER_KEY,
    adapterVersion: PNPM_AUDIT_ADAPTER_VERSION,
    supportedScopes: ["bom-component", "build-artifact-revision", "release-bundle"],
    async run(input: AssuranceRunInput): Promise<AssuranceRunOutput> {
      const jsonText = typeof input.input.jsonText === "string" ? input.input.jsonText : "";
      const lookup = (input.input.lookup ?? {}) as PnpmAuditComponentLookup;
      const result = runPnpmAuditAdapter({ jsonText, lookup });
      const { componentIdsByAffectedId: _ids, advisoryCount: _ad, ...rest } = result;
      return rest;
    },
  };
}
