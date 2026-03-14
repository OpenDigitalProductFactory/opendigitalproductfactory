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
