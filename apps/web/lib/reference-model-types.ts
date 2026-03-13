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
