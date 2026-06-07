// Data Architecture steward applier — EP-DATA-ARCH Phase 4 (BI-6E5BF91F).
//
// Writes deterministic drift findings to EaConformanceIssue rows idempotently:
// one open issue per stable issueKey. Re-running updates matched issues in place
// and auto-resolves issues whose drift has been fixed (self-healing). Pure
// detection lives in data-architecture-steward.ts.

import { detectDrift, summarizeFindings, type DriftFinding } from "./data-architecture-steward";
import type { PrismaSchemaFacts } from "../integrate/code-graph/extractors/prisma-schema-adapter";

const STEWARD_ISSUE_TYPES = [
  "fk-without-index",
  "missing-inverse-relation",
  "orphan-model",
  "ignored-model",
];

export type StewardPrismaClient = {
  eaView: {
    findFirst(args: Record<string, unknown>): Promise<{ id: string } | null>;
  };
  eaConformanceIssue: {
    findMany(args: Record<string, unknown>): Promise<Array<{ id: string; issueType: string; message: string; severity: string; detailsJson: unknown }>>;
    create(args: Record<string, unknown>): Promise<{ id: string }>;
    update(args: Record<string, unknown>): Promise<unknown>;
  };
};

export type StewardResult = {
  created: number;
  updated: number;
  resolved: number;
  byType: Record<string, number>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function issueKeyOf(detailsJson: unknown): string | null {
  const key = asRecord(detailsJson).issueKey;
  return typeof key === "string" ? key : null;
}

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

  const existing = await prisma.eaConformanceIssue.findMany({
    where: { issueType: { in: STEWARD_ISSUE_TYPES }, status: "open" },
    select: { id: true, issueType: true, message: true, severity: true, detailsJson: true },
  });
  const existingByKey = new Map<string, (typeof existing)[number]>();
  for (const row of existing) {
    const key = issueKeyOf(row.detailsJson);
    if (key) existingByKey.set(key, row);
  }

  const findingByKey = new Map<string, DriftFinding>(findings.map((f) => [f.issueKey, f]));

  let created = 0;
  let updated = 0;
  let resolved = 0;

  // Create or update issues for current findings.
  for (const finding of findings) {
    const match = existingByKey.get(finding.issueKey);
    const detailsJson = { ...finding.details, issueKey: finding.issueKey, steward: true };
    if (!match) {
      await prisma.eaConformanceIssue.create({
        data: {
          viewId,
          issueType: finding.issueType,
          severity: finding.severity,
          status: "open",
          message: finding.message,
          detailsJson,
        },
      });
      created += 1;
    } else if (match.message !== finding.message || match.severity !== finding.severity) {
      await prisma.eaConformanceIssue.update({
        where: { id: match.id },
        data: { message: finding.message, severity: finding.severity, detailsJson },
      });
      updated += 1;
    }
  }

  // Auto-resolve open steward issues whose drift is gone.
  for (const [key, row] of existingByKey) {
    if (!findingByKey.has(key)) {
      await prisma.eaConformanceIssue.update({ where: { id: row.id }, data: { status: "resolved" } });
      resolved += 1;
    }
  }

  return { created, updated, resolved, byType: summarizeFindings(findings) };
}
