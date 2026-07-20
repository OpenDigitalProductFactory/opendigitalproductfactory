// Generalized Parity Engine steward.
//
// The projection reconciler re-derives each live SysML/BPMN view from its source
// registry/manifest/graph/state machine. This steward makes projection health
// observable in the EA conformance substrate: if a domain skips because required
// source substrate is unavailable, it files a stable issue; when the domain becomes
// healthy again, the issue is auto-resolved.

import { prisma } from "@dpf/db";
import { reconcileSysmlProjections, type SysmlProjectionsResult } from "./reconcile-sysml-projections";
import {
  reconcileConformanceIssues,
  type ConformanceIssueClient,
} from "./conformance-issue-reconciler";

const PARITY_STEWARD = "architecture-parity";
const PROJECTION_UNAVAILABLE = "parity-projection-unavailable";
const MANAGED_ISSUE_TYPES = [PROJECTION_UNAVAILABLE];

type ProjectionDomain = keyof SysmlProjectionsResult;

type ProjectionStatus = {
  status: "applied" | "noop" | "skipped";
  created: number;
  updated: number;
  removed: number;
};

type ProjectionFinding = {
  issueKey: string;
  domain: ProjectionDomain;
  issueType: string;
  severity: string;
  message: string;
  details: Record<string, unknown>;
};

export type ArchitectureParityStewardClient = ConformanceIssueClient;

export type ArchitectureParityStewardResult = {
  created: number;
  updated: number;
  resolved: number;
  openByDomain: Record<string, number>;
};

export type ArchitectureParityRunResult = {
  projections: SysmlProjectionsResult;
  steward: ArchitectureParityStewardResult;
};

const DOMAIN_LABELS: Record<ProjectionDomain, string> = {
  mcpAuthority: "MCP tool authority",
  coworkerAuthority: "AI coworker workforce",
  valueStreams: "IT4IT value streams",
  routes: "Next.js route tree",
  navigation: "navigation surface (rail + route reachability)",
  codeStructure: "source-code structure",
  processModels: "platform process models",
  skillToolchain: "skill & agent toolchain",
  operationalGraph: "operational graph (live runtime)",
  networkTopology: "network topology (discovered)",
  integrations: "connected-application integrations",
  scheduledJobs: "scheduling surface (all scheduled work)",
  it4itCoverage: "IT4IT functional-criteria coverage",
  securityPosture: "security operations (SOC) surface",
  workPatternArchitecture: "governed adaptive playbooks",
  federatedDemandArchitecture: "federated demand network",
};

function projectionEntries(result: SysmlProjectionsResult): Array<[ProjectionDomain, ProjectionStatus]> {
  return (Object.entries(result) as Array<[ProjectionDomain, ProjectionStatus]>);
}

function detectProjectionFindings(result: SysmlProjectionsResult): ProjectionFinding[] {
  const findings: ProjectionFinding[] = [];
  for (const [domain, projection] of projectionEntries(result)) {
    if (projection.status !== "skipped") continue;
    const issueKey = `${PARITY_STEWARD}:${domain}:unavailable`;
    const label = DOMAIN_LABELS[domain];
    findings.push({
      issueKey,
      domain,
      issueType: PROJECTION_UNAVAILABLE,
      severity: "warn",
      message: `Parity projection for ${label} is unavailable; reconcile returned status=skipped.`,
      details: {
        issueKey,
        steward: PARITY_STEWARD,
        domain,
        label,
        status: projection.status,
        created: projection.created,
        updated: projection.updated,
        removed: projection.removed,
      },
    });
  }
  return findings;
}

async function reconcileParityIssues(
  db: ArchitectureParityStewardClient,
  projections: SysmlProjectionsResult,
): Promise<ArchitectureParityStewardResult> {
  const findings = detectProjectionFindings(projections);
  const openByDomain: Record<string, number> = {};

  for (const finding of findings) {
    openByDomain[finding.domain] = (openByDomain[finding.domain] ?? 0) + 1;
  }

  const result = await reconcileConformanceIssues(db, {
    issueTypes: MANAGED_ISSUE_TYPES,
    findings: findings.map((finding) => ({
      issueKey: finding.issueKey,
      issueType: finding.issueType,
      severity: finding.severity,
      message: finding.message,
      detailsJson: finding.details,
    })),
  });

  return { ...result, openByDomain };
}

export async function runArchitectureParitySteward(
  opts: {
    prisma?: ArchitectureParityStewardClient;
    db?: typeof prisma;
    reconcile?: () => Promise<SysmlProjectionsResult>;
  } = {},
): Promise<ArchitectureParityRunResult> {
  const stewardDb = (opts.prisma ?? opts.db ?? prisma) as ArchitectureParityStewardClient;
  const projectionDb = opts.db ?? prisma;
  const reconcile = opts.reconcile ?? (() => reconcileSysmlProjections({ db: projectionDb }));
  const projections = await reconcile();
  const steward = await reconcileParityIssues(stewardDb, projections);
  return { projections, steward };
}
