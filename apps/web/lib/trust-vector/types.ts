export type TrustStatementKind =
  | "current-fact"
  | "last-known-fact"
  | "inferred-result"
  | "low-confidence-result";

export type TrustTier = "high" | "medium" | "low" | "unknown";

export type TrustAction =
  | "present"
  | "qualify"
  | "warn-stale"
  | "refresh-required"
  | "escalate"
  | "defer";

export type TrustRiskLevel = "low" | "medium" | "high" | "critical";

export type TrustDimensionKey =
  | "freshness"
  | "sourceAuthority"
  | "evidenceGrade"
  | "coverageCompleteness"
  | "toolRecency"
  | "toolReliability"
  | "graphTraversalDepth"
  | "dataLineage"
  | "humanValidation"
  | "conflictContradiction"
  | "runtimeAvailability"
  | "sampleSize"
  | "riskImpact";

export type TrustEvidenceRef = {
  kind:
    | "prisma-row"
    | "neo4j-node"
    | "neo4j-relationship"
    | "tool-execution"
    | "assurance-run"
    | "bom-document"
    | "assurance-finding"
    | "wiki-page"
    | "decision-interaction"
    | "gear-interface"
    | "external-provider";
  label: string;
  ref: string;
  sourceTable?: string;
  sourceRoute?: string;
};

export type TrustSubject = {
  type: string;
  id: string;
  label: string;
};

export type TrustDimensionInput = {
  key: TrustDimensionKey;
  label: string;
  score: number | null;
  weight?: number;
  rationale: string;
  measuredAt?: string;
  expiresAt?: string;
  evidenceRefs?: TrustEvidenceRef[];
};

export type TrustDimension = Required<Pick<TrustDimensionInput, "key" | "label" | "score" | "rationale">> & {
  tier: TrustTier;
  weight: number;
  measuredAt?: string;
  expiresAt?: string;
  evidenceRefs: TrustEvidenceRef[];
};

export type TrustAssessment = {
  kind: "data-trust-vector";
  schemaVersion: 1;
  subject: TrustSubject;
  statementKind: TrustStatementKind;
  tier: TrustTier;
  overallScore: number | null;
  action: TrustAction;
  asOf: string;
  summary: string;
  primaryRationale: string;
  dimensions: TrustDimension[];
  sourceSummary: string;
  auditRef?: TrustEvidenceRef;
};

export type ScoreTrustVectorInput = {
  subject: TrustSubject;
  asOf: string;
  dimensions: TrustDimensionInput[];
  riskLevel?: TrustRiskLevel;
  sourceSummary?: string;
  auditRef?: TrustEvidenceRef;
};
