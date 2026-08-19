// Data Architecture steward applier — EP-DATA-ARCH Phase 4 (BI-6E5BF91F).
//
// Writes deterministic drift findings to EaConformanceIssue rows idempotently:
// one open issue per stable issueKey. Re-running updates matched issues in place
// and auto-resolves issues whose drift has been fixed (self-healing). Pure
// detection lives in data-architecture-steward.ts.

import { detectDrift, summarizeFindings, type DriftFinding } from "./data-architecture-steward";
import {
  reconcileConformanceIssues,
  type ConformanceIssueClient,
} from "./conformance-issue-reconciler";
import type { PrismaSchemaFacts } from "../build/code-graph/extractors/prisma-schema-adapter";

const STEWARD_ISSUE_TYPES = [
  "fk-without-index",
  "missing-inverse-relation",
  "orphan-model",
  "ignored-model",
];

export type StewardPrismaClient = ConformanceIssueClient & {
  eaView: {
    findFirst(args: Record<string, unknown>): Promise<{ id: string } | null>;
  };
};

export type StewardResult = {
  created: number;
  updated: number;
  resolved: number;
  byType: Record<string, number>;
};

/**
 * Run the deterministic steward pass and reconcile EaConformanceIssue rows.
 * Idempotent: re-running with unchanged facts creates nothing; fixed drift is
 * auto-resolved.
 */
export async function runDataArchitectureSteward(deps: {
  prisma: StewardPrismaClient;
  facts: PrismaSchemaFacts;
}): Promise<StewardResult> {
  const { prisma, facts } = deps;
  const findings = detectDrift(facts);

  const view = await prisma.eaView.findFirst({
    where: { scopeType: "data-model", scopeRef: "prisma" },
  });
  const viewId = view?.id ?? null;

  const result = await reconcileConformanceIssues(prisma, {
    issueTypes: STEWARD_ISSUE_TYPES,
    findings: findings.map((finding: DriftFinding) => ({
      issueKey: finding.issueKey,
      issueType: finding.issueType,
      severity: finding.severity,
      message: finding.message,
      viewId,
      detailsJson: { ...finding.details, steward: true },
    })),
  });

  return { ...result, byType: summarizeFindings(findings) };
}
