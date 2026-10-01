// apps/web/lib/ai-readiness/readiness-summary-types.ts
//
// The AI readiness summary contract (readiness-summary.ts composes it, the
// readiness page, its panel and the attention projection render it). Types
// only, no imports: readers name the summary shape without importing the
// composer, which reaches provider data and phase model resolution
// (dependency-diet plan M11 step 2 needs apps/web's all-imports graph acyclic).

export type ReadinessState = "ready" | "attention" | "blocked" | "diagnostic";

export type AiReadinessDomainId =
  | "model-supply"
  | "build-execution"
  | "tool-access"
  | "routing-confidence";

export interface AiReadinessEvidence {
  label: string;
  value: string;
  at?: string;
}

export interface AiReadinessBlocker {
  code: string;
  message: string;
  primaryActionLabel: string;
  href?: string;
}

export interface AiReadinessDomain {
  id: AiReadinessDomainId;
  label: string;
  state: ReadinessState;
  summary: string;
  evidence: AiReadinessEvidence[];
  blocker?: AiReadinessBlocker;
  diagnosticsHref: string;
}

export interface AiReadinessSummary {
  state: Exclude<ReadinessState, "diagnostic">;
  summary: string;
  generatedAt: string;
  domains: AiReadinessDomain[];
}
