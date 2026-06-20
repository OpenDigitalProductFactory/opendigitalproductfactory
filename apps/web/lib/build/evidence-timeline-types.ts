// Canonical shape for a single event on the Build Studio unified evidence
// timeline. Lives in lib (not the client component) so server-side projection
// code can produce these without importing a "use client" module. The
// UnifiedEvidenceTimeline component re-exports this type for back-compat.
//
// EP-UNIFIED-TRACKING Phase 1 (BI-C25374E4): the timeline must render real
// cross-surface evidence (external-agent records, runtime verification, capsule
// evidence), not just FeatureBuild columns.

export type UnifiedEvidenceTimelineEvent = {
  id: string;
  source: "build-studio" | "codex" | "local-integration" | "review" | "external";
  label: string;
  summary: string;
  status?: "passed" | "pending" | "failed" | "recorded";
  timestamp?: string | Date | null;
};
