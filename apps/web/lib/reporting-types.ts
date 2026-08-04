// apps/web/lib/reporting-types.ts
import * as crypto from "crypto";
import {
  isRegulationDomain,
  REGULATION_DOMAINS,
  type RegulationDomain,
} from "@dpf/db/regulation-applicability";

function genId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export const generateSnapshotId = () => genId("SNAP");

export type PostureInput = {
  totalObligations: number; coveredObligations: number;
  totalControls: number; implementedControls: number;
  openIncidents: number; overdueActions: number;
};

export function calculatePostureScore(input: PostureInput): number {
  const obligationCoverage = input.totalObligations > 0 ? input.coveredObligations / input.totalObligations : 1;
  const controlImplementation = input.totalControls > 0 ? input.implementedControls / input.totalControls : 1;
  const incidentFree = input.totalObligations > 0 ? Math.max(0, 1 - input.openIncidents / input.totalObligations) : 1;
  const actionTimeliness = input.totalControls > 0 ? Math.max(0, 1 - input.overdueActions / input.totalControls) : 1;
  const raw = (obligationCoverage * 0.4 + controlImplementation * 0.3 + incidentFree * 0.15 + actionTimeliness * 0.15) * 100;
  return Math.round(Math.max(0, Math.min(100, raw)));
}

export const SUBMISSION_STATUS_FLOW: Record<string, string[]> = {
  draft: ["pending"],
  pending: ["submitted", "draft"],
  submitted: ["acknowledged", "rejected"],
  rejected: ["draft"],
  acknowledged: [],
};

export function isValidSubmissionTransition(from: string, to: string): boolean {
  return SUBMISSION_STATUS_FLOW[from]?.includes(to) ?? false;
}

export type ObligationGapStatus = "covered" | "partial" | "uncovered";

export type ObligationGap = {
  id: string; obligationId: string; title: string; reference: string | null;
  category: string | null; status: ObligationGapStatus;
  controlCount: number; implementedControlCount: number;
};

export type RegulationGapSummary = {
  id: string; shortName: string; jurisdiction: string;
  /** Functional domain this regulation is attributed to (null → cross-cutting). */
  domain: string | null;
  totalObligations: number; coveredObligations: number;
  partialObligations: number; uncoveredObligations: number;
  coveragePercent: number; obligations: ObligationGap[];
};

// ── By-function (domain) rollup ──────────────────────────────────────────────
// Aggregates the per-regulation gap data into one row per functional domain, so
// the central posture surface shows what each context (HR, finance, security…)
// must apply and how covered it is. Pure — no DB access; groups the gapData the
// reporting layer already fetched.

export const DOMAIN_LABEL: Record<RegulationDomain, string> = {
  "privacy-security": "Privacy & Security",
  "hr-employment": "HR & Employment",
  finance: "Finance",
  "ai-governance": "AI Governance",
  "consumer-marketing": "Consumer & Marketing",
  accessibility: "Accessibility",
  "corporate-governance": "Corporate Governance",
  sector: "Sector-specific",
  "cross-cutting": "Cross-cutting",
};

export type DomainScore = {
  domain: RegulationDomain;
  label: string;
  regulationCount: number;
  totalObligations: number;
  coveredObligations: number;
  uncoveredObligations: number;
  coveragePercent: number;
};

/**
 * Group applicable regulations by functional domain. A NULL or unrecognized
 * domain folds into `cross-cutting` (guarded via isRegulationDomain) so a
 * between-deploy-and-backfill window degrades gracefully instead of dropping
 * regulations. Empty domains are omitted; coverage is covered/total (100 when
 * a domain has no obligations), matching the per-regulation coveragePercent.
 */
export function calculateDomainScores(gapData: RegulationGapSummary[]): DomainScore[] {
  const buckets = new Map<RegulationDomain, DomainScore>();
  for (const reg of gapData) {
    const domain: RegulationDomain = isRegulationDomain(reg.domain) ? reg.domain : "cross-cutting";
    let b = buckets.get(domain);
    if (!b) {
      b = {
        domain,
        label: DOMAIN_LABEL[domain],
        regulationCount: 0,
        totalObligations: 0,
        coveredObligations: 0,
        uncoveredObligations: 0,
        coveragePercent: 100,
      };
      buckets.set(domain, b);
    }
    b.regulationCount += 1;
    b.totalObligations += reg.totalObligations;
    b.coveredObligations += reg.coveredObligations;
    b.uncoveredObligations += reg.uncoveredObligations;
  }
  const scores = [...buckets.values()].map((b) => ({
    ...b,
    coveragePercent: b.totalObligations > 0 ? Math.round((b.coveredObligations / b.totalObligations) * 100) : 100,
  }));
  // Stable, meaningful order: by the canonical domain enum order.
  return scores.sort((a, b) => REGULATION_DOMAINS.indexOf(a.domain) - REGULATION_DOMAINS.indexOf(b.domain));
}
