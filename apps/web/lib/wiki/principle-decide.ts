// Back-compat re-export shim (decision-surface consolidation, BI-E1FB2307).
//
// The pure option-scoring engine (computeStructuredAlignment,
// computeSemanticAlignment, buildOptionScores, decide, + their types) moved to
// `apps/web/lib/decision/option-scoring.ts` so the Decision Perspective Gate
// and the `principle_decide` MCP handler share ONE inner engine rather than two
// parallel decision paths. The engine remains pure (no I/O); retrieval and
// profile resolution live in the Gate boundary, not here.
//
// Existing importers (mcp-tools.ts, kernel/runtime-gate.ts, tests) import from
// this path unchanged — this shim re-exports the engine verbatim.

export * from "../decision/option-scoring";
