import type { BrandDesignSystem } from "../types";

export type ExtractionInput = {
  organizationId: string;
  taskRunId: string;
  userId: string;
  threadId: string | null;
  sources: {
    url?: string;
    codebasePath?: string;
    uploads?: Array<{ name: string; mimeType: string; data: Buffer }>;
  };
};

export type ExtractionStage =
  | "scraping"
  | "reading-codebase"
  | "parsing-uploads"
  | "merging"
  | "synthesizing"
  | "writing";

export type ExtractionProgress = {
  stage: ExtractionStage;
  message: string;
  percent: number;
};

export type ExtractionResult = {
  designSystem: BrandDesignSystem;
  sourcesUsed: BrandDesignSystem["sources"];
  durationMs: number;
};

export type PartialDesignSystem = Partial<BrandDesignSystem> & {
  confidence?: { overall?: number; perField?: Record<string, number> };
};

export type ProgressEmitter = (p: ExtractionProgress) => Promise<void>;
