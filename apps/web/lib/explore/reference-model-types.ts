export type CoverageStatus =
  | "implemented"
  | "partial"
  | "planned"
  | "not_started"
  | "out_of_mvp";

export type ReferenceModelSummary = {
  id: string;
  slug: string;
  name: string;
  version: string;
  status: string;
  criteriaCount: number;
  assessmentCount: number;
  proposalCount: number;
};

export type ReferenceModelPortfolioRollupRow = {
  scopeRef: string;
  scopeName: string;
  counts: Record<CoverageStatus, number>;
  mvpIncludedCount: number;
  outOfMvpCount: number;
};

export type ReferenceModelPortfolioRollup = {
  model: {
    id: string;
    slug: string;
    name: string;
    version: string;
  };
  rows: ReferenceModelPortfolioRollupRow[];
};

export type ReferenceModelElementNode = {
  id: string;
  parentId: string | null;
  kind: string;
  name: string;
  description: string | null;
  properties: Record<string, unknown>;
};

export type It4itCriterionCoverage = {
  id: string;
  name: string;
  normativeClass: string | null;
  sourceReference: string | null;
  status: CoverageStatus;
  confidence: string | null;
};

export type It4itComponentCoverage = {
  id: string;
  name: string;
  capabilityGroup: string;
  status: CoverageStatus;
  /** Evidence score 0..100 (drives heatmap intensity); 0 when unassessed. */
  score: number;
  confidence: string | null;
  criteriaCount: number;
  requiredCriteriaCount: number;
  criteria: It4itCriterionCoverage[];
};

export type It4itCoverageGroup = {
  group: string;
  /** Status-weighted coverage rollup 0..100 over the group's functional criteria. */
  score: number;
  componentCount: number;
  componentsWithEvidence: number;
  components: It4itComponentCoverage[];
};

export type It4itCoverageHeatmap = {
  modelSlug: string;
  modelName: string;
  /** True once the steward projection has written platform-scope assessments. */
  hasData: boolean;
  assessmentCount: number;
  generatedAt: string | null;
  /** Status-weighted coverage rollup 0..100 over all functional criteria. */
  platformScore: number;
  groups: It4itCoverageGroup[];
  summary: {
    componentsTotal: number;
    componentsWithEvidence: number;
    implemented: number;
    partial: number;
    requiredCriteriaTotal: number;
    requiredCriteriaImplemented: number;
    requiredCriteriaPartial: number;
    verifiedCount: number;
  };
  method: string;
};

export type ReferenceModelDetail = {
  id: string;
  slug: string;
  name: string;
  version: string;
  status: string;
  authorityType: string;
  description: string | null;
  valueStreamProjection: {
    viewId: string | null;
    viewName: string | null;
    isProjected: boolean;
  };
  artifacts: Array<{
    id: string;
    path: string;
    kind: string;
    authority: string;
  }>;
  proposals: Array<{
    id: string;
    proposalType: string;
    status: string;
    proposedByType: string;
    reviewNotes: string | null;
  }>;
};
