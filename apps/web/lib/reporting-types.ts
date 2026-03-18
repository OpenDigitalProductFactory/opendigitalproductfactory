// apps/web/lib/reporting-types.ts
import * as crypto from "crypto";

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
  totalObligations: number; coveredObligations: number;
  partialObligations: number; uncoveredObligations: number;
  coveragePercent: number; obligations: ObligationGap[];
};
