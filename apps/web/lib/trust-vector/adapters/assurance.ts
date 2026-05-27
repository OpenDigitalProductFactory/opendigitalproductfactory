import { scoreTrustVector } from "@/lib/trust-vector/score";
import type { TrustAssessment, TrustDimensionInput } from "@/lib/trust-vector/types";
import type { BomSummary } from "@/lib/assurance/bom-read";

type AssuranceTrustOptions = {
  asOf?: Date | string;
};

export function buildAssuranceSummaryTrust(
  summary: BomSummary,
  options: AssuranceTrustOptions = {},
): TrustAssessment {
  const asOf = toDate(options.asOf) ?? new Date();
  const dimensions: TrustDimensionInput[] = [
    buildScanFreshnessDimension(summary, asOf),
    buildBomLineageDimension(summary, asOf),
    buildToolReliabilityDimension(summary),
    buildSourceAuthorityDimension(summary),
    buildCoverageDimension(summary),
  ];

  if (summary.findings.blocking > 0) {
    dimensions.push({
      key: "riskImpact",
      label: "Risk impact",
      score: 0.4,
      rationale: `${summary.findings.blocking} blocking assurance finding${summary.findings.blocking === 1 ? "" : "s"} require review.`,
      evidenceRefs: [],
    });
  }

  return scoreTrustVector({
    subject: {
      type: "assurance-summary",
      id: summary.document?.documentId ?? "missing-bom",
      label: "Assurance summary",
    },
    asOf: asOf.toISOString(),
    dimensions,
    riskLevel: "high",
    sourceSummary: "Assurance trust is derived from BOM freshness, scan recency, finding evidence, and scanner readiness.",
  });
}

function buildScanFreshnessDimension(summary: BomSummary, asOf: Date): TrustDimensionInput {
  if (summary.state === "stale") {
    return {
      key: "freshness",
      label: "Scan freshness",
      score: 0.2,
      weight: 2,
      rationale: "The latest BOM document is marked stale.",
      evidenceRefs: [],
    };
  }

  const completedAt = summary.latestAssuranceRunCompletedAt ?? summary.document?.generatedAt ?? null;

  if (!completedAt) {
    return {
      key: "freshness",
      label: "Scan freshness",
      score: 0.1,
      weight: 2,
      rationale: "No assurance scan has completed for this scope.",
      evidenceRefs: [],
    };
  }

  const completedDate = toDate(completedAt);
  if (!completedDate) {
    return {
      key: "freshness",
      label: "Scan freshness",
      score: 0.1,
      weight: 2,
      rationale: "Latest assurance scan completion time is invalid.",
      evidenceRefs: [],
    };
  }

  const ageDays = ageInDays(completedDate, asOf);
  if (ageDays <= 7) {
    return {
      key: "freshness",
      label: "Scan freshness",
      score: 1,
      weight: 2,
      rationale: "Latest assurance scan completed within the last 7 days.",
      measuredAt: completedDate.toISOString(),
      evidenceRefs: [],
    };
  }

  if (ageDays <= 30) {
    return {
      key: "freshness",
      label: "Scan freshness",
      score: 0.7,
      weight: 2,
      rationale: `Latest assurance scan completed ${ageDays} ${ageDays === 1 ? "day" : "days"} ago.`,
      measuredAt: completedDate.toISOString(),
      evidenceRefs: [],
    };
  }

  return {
    key: "freshness",
    label: "Scan freshness",
    score: 0.2,
    weight: 2,
    rationale: `Latest assurance scan completed ${ageDays} ${ageDays === 1 ? "day" : "days"} ago.`,
    measuredAt: completedDate.toISOString(),
    evidenceRefs: [],
  };
}

function buildBomLineageDimension(summary: BomSummary, asOf: Date): TrustDimensionInput {
  if (!summary.document) {
    return {
      key: "dataLineage",
      label: "BOM lineage",
      score: 0.1,
      rationale: "No BOM document is available for this scope.",
      evidenceRefs: [],
    };
  }

  if (summary.state === "stale") {
    return {
      key: "dataLineage",
      label: "BOM lineage",
      score: 0.2,
      rationale: "The latest BOM document is marked stale.",
      evidenceRefs: [{
        kind: "bom-document",
        label: "BomDocument",
        ref: summary.document.documentId,
        sourceTable: "BomDocument",
      }],
    };
  }

  const ageDays = ageInDays(summary.document.generatedAt, asOf);
  const score = ageDays <= 14 ? 1 : ageDays <= 45 ? 0.7 : 0.2;

  return {
    key: "dataLineage",
    label: "BOM lineage",
    score,
    rationale: `Latest BOM document was generated ${ageDays} ${ageDays === 1 ? "day" : "days"} ago.`,
    measuredAt: summary.document.generatedAt.toISOString(),
    evidenceRefs: [{
      kind: "bom-document",
      label: "BomDocument",
      ref: summary.document.documentId,
      sourceTable: "BomDocument",
    }],
  };
}

function buildToolReliabilityDimension(summary: BomSummary): TrustDimensionInput {
  const ready = summary.scanner.state === "ready";
  return {
    key: "toolReliability",
    label: "Scanner readiness",
    score: ready ? 1 : 0.2,
    weight: 2,
    rationale: ready
      ? `Approved scanner available: ${summary.scanner.scannerNames.join(", ")}.`
      : "No approved assurance scanner is available.",
    evidenceRefs: [],
  };
}

function buildSourceAuthorityDimension(summary: BomSummary): TrustDimensionInput {
  return {
    key: "sourceAuthority",
    label: "Source authority",
    score: summary.document ? 0.9 : 0.4,
    rationale: summary.document
      ? "BomDocument and AssuranceFinding are authoritative for persisted assurance results."
      : "No authoritative BOM document is available yet.",
    evidenceRefs: summary.document
      ? [{
          kind: "bom-document",
          label: "BomDocument",
          ref: summary.document.documentId,
          sourceTable: "BomDocument",
        }]
      : [],
  };
}

function buildCoverageDimension(summary: BomSummary): TrustDimensionInput {
  if (!summary.document) {
    return {
      key: "coverageCompleteness",
      label: "Coverage",
      score: 0.1,
      rationale: "No BOM components are available for coverage assessment.",
      evidenceRefs: [],
    };
  }

  const score = summary.counts.components > 0 ? 0.85 : 0.4;
  return {
    key: "coverageCompleteness",
    label: "Coverage",
    score,
    rationale: `${summary.counts.components} component${summary.counts.components === 1 ? "" : "s"} captured in the latest BOM.`,
    evidenceRefs: [],
  };
}

function ageInDays(from: Date, asOf: Date): number {
  const ageMs = Math.max(0, asOf.getTime() - from.getTime());
  return Math.floor(ageMs / (1000 * 60 * 60 * 24));
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
